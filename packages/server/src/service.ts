import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DEFAULT_SERVER_PORT, resolveCodoriHome } from './config.js'
import { scanProjects } from './project-scanner.js'

export type ServiceScope = 'user' | 'system'

export type ServicePlatform = 'darwin' | 'linux'

export type ServiceInstallMetadata = {
  installId: string
  root: string
  host: string
  port: number
  scope: ServiceScope
  platform: ServicePlatform
  serviceName: string
  serviceFilePath: string
  launcherPath: string
  installedAt: string
}

export type RootPromptDefault = {
  value: string | null
  reason: 'git' | 'workspace-marker' | 'nested-git-projects' | 'none'
  shouldConfirm: boolean
}

export type HostPromptDefault = {
  value: string
  source: 'explicit' | 'tailscale' | 'wildcard'
  warning: string | null
}

export type CommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

export type CommandRunner = (command: string, args: string[]) => Promise<CommandResult>

export type LauncherScriptInput = {
  root: string
  host: string
  port: number
  nodePath: string
  npxPath: string
}

const WORKSPACE_MARKER_NAMES = [
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json'
]

const SUPPORTED_SERVICE_SCOPES = new Set<ServiceScope>(['user', 'system'])

const WILDCARD_HOST_WARNING = [
  'Binding Codori to 0.0.0.0 can expose it without authentication.',
  'Set up a firewall or use a private network such as Tailscale before continuing.'
].join(' ')

const defaultCommandRunner: CommandRunner = (command, args) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (exitCode) => {
      resolvePromise({
        exitCode,
        stdout,
        stderr
      })
    })
  })

const shellEscape = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`

const findFirstIpv4 = (values: unknown) => {
  if (!Array.isArray(values)) {
    return null
  }

  for (const value of values) {
    if (typeof value === 'string' && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
      return value
    }
  }

  return null
}

export const toServiceInstallId = (root: string) =>
  createHash('sha256').update(resolve(root)).digest('hex').slice(0, 12)

export const getServiceMetadataDirectory = (installId: string, homeDir = os.homedir()) =>
  join(resolveCodoriHome(homeDir), 'services', installId)

export const getServiceMetadataPath = (installId: string, homeDir = os.homedir()) =>
  join(getServiceMetadataDirectory(installId, homeDir), 'service.json')

export const getServiceLauncherPath = (installId: string, homeDir = os.homedir()) =>
  join(getServiceMetadataDirectory(installId, homeDir), 'run-service.sh')

export const detectRootPromptDefault = (cwd: string): RootPromptDefault => {
  const resolvedCwd = resolve(cwd)

  if (existsSync(join(resolvedCwd, '.git'))) {
    return {
      value: resolvedCwd,
      reason: 'git',
      shouldConfirm: true
    }
  }

  if (WORKSPACE_MARKER_NAMES.some(marker => existsSync(join(resolvedCwd, marker)))) {
    return {
      value: resolvedCwd,
      reason: 'workspace-marker',
      shouldConfirm: true
    }
  }

  if (scanProjects(resolvedCwd).length > 0) {
    return {
      value: resolvedCwd,
      reason: 'nested-git-projects',
      shouldConfirm: true
    }
  }

  return {
    value: null,
    reason: 'none',
    shouldConfirm: false
  }
}

export const resolveServiceScope = (value: string | undefined): ServiceScope => {
  if (!value) {
    return 'user'
  }

  if (SUPPORTED_SERVICE_SCOPES.has(value as ServiceScope)) {
    return value as ServiceScope
  }

  throw new Error(`Unsupported service scope "${value}". Expected "user" or "system".`)
}

export const parseServicePort = (value: string | number | undefined) => {
  if (value === undefined) {
    return undefined
  }

  const parsed = typeof value === 'number'
    ? value
    : Number.parseInt(value, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid service port "${value}". Expected an integer between 1 and 65535.`)
  }

  return parsed
}

export const resolveDefaultServicePort = (value: number | undefined) =>
  value ?? DEFAULT_SERVER_PORT

export const getWildcardHostWarning = () => WILDCARD_HOST_WARNING

export const detectTailscaleIpv4 = async (runCommand: CommandRunner = defaultCommandRunner) => {
  try {
    const status = await runCommand('tailscale', ['status', '--json'])
    if (status.exitCode === 0) {
      const parsed: unknown = JSON.parse(status.stdout)
      if (typeof parsed === 'object' && parsed !== null) {
        const backendState = 'BackendState' in parsed ? parsed.BackendState : undefined
        const self = 'Self' in parsed ? parsed.Self : undefined
        const selfIps = typeof self === 'object' && self !== null && 'TailscaleIPs' in self
          ? self.TailscaleIPs
          : undefined
        const statusIps = 'TailscaleIPs' in parsed ? parsed.TailscaleIPs : undefined

        if (backendState === 'Running') {
          return findFirstIpv4(selfIps) ?? findFirstIpv4(statusIps)
        }
      }
    }
  } catch {
    // Fall back to the direct IP command.
  }

  try {
    const ipResult = await runCommand('tailscale', ['ip', '-4'])
    if (ipResult.exitCode !== 0) {
      return null
    }

    const line = ipResult.stdout
      .split(/\r?\n/u)
      .map(value => value.trim())
      .find(Boolean)

    return line && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(line) ? line : null
  } catch {
    return null
  }
}

export const resolveHostPromptDefault = async (
  explicitHost: string | undefined,
  runCommand: CommandRunner = defaultCommandRunner
): Promise<HostPromptDefault> => {
  if (explicitHost) {
    return {
      value: explicitHost,
      source: 'explicit',
      warning: explicitHost === '0.0.0.0' ? WILDCARD_HOST_WARNING : null
    }
  }

  const tailscaleIpv4 = await detectTailscaleIpv4(runCommand)
  if (tailscaleIpv4) {
    return {
      value: tailscaleIpv4,
      source: 'tailscale',
      warning: null
    }
  }

  return {
    value: '0.0.0.0',
    source: 'wildcard',
    warning: WILDCARD_HOST_WARNING
  }
}

export const buildLauncherScript = ({
  root,
  host,
  port,
  nodePath,
  npxPath
}: LauncherScriptInput) => {
  const pathEntries = Array.from(new Set([dirname(nodePath), dirname(npxPath)]))
  const exportPath = `${pathEntries.map(shellEscape).join(':')}:$PATH`

  return [
    '#!/bin/sh',
    'set -eu',
    `export PATH=${exportPath}`,
    `exec ${shellEscape(npxPath)} --yes @codori/server serve --root ${shellEscape(resolve(root))} --host ${shellEscape(host)} --port ${port}`
  ].join('\n')
}

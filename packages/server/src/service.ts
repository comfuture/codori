import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import {
  createDarwinServiceDefinition,
  createLinuxServiceDefinition,
  getDarwinInstallCommands,
  getDarwinRestartCommands,
  getDarwinUninstallCommands,
  getLinuxInstallCommands,
  getLinuxRestartCommands,
  getLinuxUninstallCommands,
  resolveServicePlatform,
  type ServiceCommand,
  type ServiceUnitDefinition
} from './service-adapters.js'
import { DEFAULT_SERVER_PORT, resolveCodoriHome } from './config.js'
import { CodoriError } from './errors.js'
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
  installId: string
  root: string
  host: string
  port: number
  scope: ServiceScope
  nodePath: string
  npxPath: string
}

export type ServicePrompt = {
  input: (message: string, defaultValue?: string) => Promise<string>
  confirm: (message: string, defaultValue: boolean) => Promise<boolean>
  close: () => Promise<void> | void
}

export type ServiceCommandName =
  | 'install-service'
  | 'setup-service'
  | 'restart-service'
  | 'uninstall-service'

export type ServiceCommandOptions = {
  root?: string
  host?: string
  port?: string | number
  scope?: string
  yes?: boolean
}

export type ServiceCommandDependencies = {
  cwd?: string
  homeDir?: string
  platform?: NodeJS.Platform
  nodePath?: string
  npxPath?: string
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  runCommand?: CommandRunner
  prompt?: ServicePrompt
  now?: () => Date
}

export type ServiceOperationResult = {
  action: 'install' | 'restart' | 'uninstall'
  metadata: ServiceInstallMetadata
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

export const CODORI_SERVICE_MANAGED_ENV = 'CODORI_SERVICE_MANAGED'
export const CODORI_SERVICE_INSTALL_ID_ENV = 'CODORI_SERVICE_INSTALL_ID'
export const CODORI_SERVICE_SCOPE_ENV = 'CODORI_SERVICE_SCOPE'

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

const writeLine = (stream: NodeJS.WritableStream, message: string) => {
  stream.write(`${message}\n`)
}

const getCurrentUserId = () => (typeof process.getuid === 'function' ? process.getuid() : 0)

const createDefaultPrompt = (
  input = process.stdin as typeof process.stdin,
  output = process.stdout as typeof process.stdout
): ServicePrompt => {
  const rl = createInterface({
    input,
    output
  })

  return {
    input: async (message, defaultValue) => {
      const suffix = defaultValue ? ` [${defaultValue}]` : ''
      const answer = (await rl.question(`${message}${suffix}: `)).trim()
      return answer || defaultValue || ''
    },
    confirm: async (message, defaultValue) => {
      const suffix = defaultValue ? ' [Y/n]' : ' [y/N]'
      const answer = (await rl.question(`${message}${suffix}: `)).trim().toLowerCase()
      if (!answer) {
        return defaultValue
      }
      if (answer === 'y' || answer === 'yes') {
        return true
      }
      if (answer === 'n' || answer === 'no') {
        return false
      }
      return defaultValue
    },
    close: async () => {
      rl.close()
    }
  }
}

const buildCanonicalInvocation = (
  command: ServiceCommandName,
  options: {
    root?: string
    host?: string
    port?: number
    scope?: ServiceScope
    yes?: boolean
  }
) => {
  const parts = ['npx', '@codori/server', command]
  if (options.root) {
    parts.push('--root', options.root)
  }
  if (options.host) {
    parts.push('--host', options.host)
  }
  if (typeof options.port === 'number') {
    parts.push('--port', String(options.port))
  }
  if (options.scope) {
    parts.push('--scope', options.scope)
  }
  if (options.yes) {
    parts.push('--yes')
  }
  return parts.map(shellEscape).join(' ')
}

const ensureDirectory = (path: string) => {
  mkdirSync(path, { recursive: true })
}

const ensureExistingDirectory = (path: string) => {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new CodoriError('INVALID_ROOT', `Project root "${path}" does not exist or is not a directory.`)
  }
}

const normalizeServiceMetadata = (value: unknown): ServiceInstallMetadata | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }

  const record = value as Record<string, unknown>
  if (
    typeof record.installId !== 'string'
    || typeof record.root !== 'string'
    || typeof record.host !== 'string'
    || typeof record.port !== 'number'
    || (record.scope !== 'user' && record.scope !== 'system')
    || (record.platform !== 'darwin' && record.platform !== 'linux')
    || typeof record.serviceName !== 'string'
    || typeof record.serviceFilePath !== 'string'
    || typeof record.launcherPath !== 'string'
    || typeof record.installedAt !== 'string'
  ) {
    return null
  }

  return record as ServiceInstallMetadata
}

const loadServiceMetadata = (root: string, homeDir = os.homedir()) => {
  const installId = toServiceInstallId(root)
  const metadataPath = getServiceMetadataPath(installId, homeDir)
  if (!existsSync(metadataPath)) {
    throw new CodoriError(
      'SERVICE_NOT_INSTALLED',
      `No service metadata was found for ${resolve(root)}. Install it first with npx @codori/server install-service.`
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(metadataPath, 'utf8'))
  } catch (error) {
    throw new CodoriError('INVALID_SERVICE_METADATA', `Failed to parse ${metadataPath}.`, error)
  }

  const metadata = normalizeServiceMetadata(parsed)
  if (!metadata) {
    throw new CodoriError('INVALID_SERVICE_METADATA', `Service metadata at ${metadataPath} is malformed.`)
  }

  return metadata
}

const resolveServiceDefinition = (
  metadata: Pick<ServiceInstallMetadata, 'installId' | 'scope' | 'root' | 'platform'>,
  homeDir: string
): ServiceUnitDefinition => {
  const metadataDirectory = getServiceMetadataDirectory(metadata.installId, homeDir)
  const launcherPath = getServiceLauncherPath(metadata.installId, homeDir)

  if (metadata.platform === 'darwin') {
    return createDarwinServiceDefinition({
      installId: metadata.installId,
      scope: metadata.scope,
      launcherPath,
      root: metadata.root,
      metadataDirectory,
      homeDir
    })
  }

  return createLinuxServiceDefinition({
    installId: metadata.installId,
    scope: metadata.scope,
    launcherPath,
    root: metadata.root,
    metadataDirectory,
    homeDir
  })
}

const resolveServiceCommands = (
  action: ServiceOperationResult['action'],
  metadata: Pick<ServiceInstallMetadata, 'platform' | 'scope'>,
  definition: ServiceUnitDefinition
) => {
  if (metadata.platform === 'darwin') {
    if (action === 'install') {
      return getDarwinInstallCommands(definition, metadata.scope)
    }
    if (action === 'restart') {
      return getDarwinRestartCommands(definition, metadata.scope)
    }
    return getDarwinUninstallCommands(definition, metadata.scope)
  }

  if (action === 'install') {
    return getLinuxInstallCommands(definition, metadata.scope)
  }
  if (action === 'restart') {
    return getLinuxRestartCommands(definition, metadata.scope)
  }
  return getLinuxUninstallCommands(definition, metadata.scope)
}

const runCommandSequence = async (
  commands: ServiceCommand[],
  runCommand: CommandRunner,
  allowFailure: (command: ServiceCommand, result: CommandResult) => boolean = () => false
) => {
  for (const command of commands) {
    let result: CommandResult
    try {
      result = await runCommand(command.command, command.args)
    } catch (error) {
      throw new CodoriError(
        'SERVICE_COMMAND_FAILED',
        `Failed to execute ${command.command} ${command.args.join(' ')}.`,
        error
      )
    }

    if (result.exitCode === 0 || allowFailure(command, result)) {
      continue
    }

    throw new CodoriError(
      'SERVICE_COMMAND_FAILED',
      `Command failed: ${command.command} ${command.args.join(' ')}`,
      result.stderr || result.stdout || null
    )
  }
}

const ensureLinuxServiceManager = async (scope: ServiceScope, runCommand: CommandRunner) => {
  let version: CommandResult
  try {
    version = await runCommand('systemctl', ['--version'])
  } catch (error) {
    throw new CodoriError('UNSUPPORTED_SERVICE_MANAGER', 'systemctl is required on Linux.', error)
  }

  if (version.exitCode !== 0) {
    throw new CodoriError('UNSUPPORTED_SERVICE_MANAGER', 'systemctl is required on Linux.')
  }

  if (scope === 'system') {
    return
  }

  const environment = await runCommand('systemctl', ['--user', 'show-environment'])
  if (environment.exitCode !== 0) {
    throw new CodoriError(
      'UNSUPPORTED_SERVICE_MANAGER',
      'systemd user services are unavailable for this session.',
      environment.stderr || environment.stdout || null
    )
  }
}

const ensureSystemScopePrivileges = (
  scope: ServiceScope,
  command: ServiceCommandName,
  options: { root?: string, host?: string, port?: number, scope?: ServiceScope, yes?: boolean }
) => {
  if (scope !== 'system' || getCurrentUserId() === 0) {
    return
  }

  const rerun = `sudo ${buildCanonicalInvocation(command, options)}`
  throw new CodoriError(
    'SERVICE_REQUIRES_SUDO',
    `System service registration requires elevated privileges. Re-run with: ${rerun}`
  )
}

const shouldIgnoreCommandFailure = (
  action: ServiceOperationResult['action'],
  metadata: Pick<ServiceInstallMetadata, 'platform'>,
  command: ServiceCommand
) => metadata.platform === 'darwin' && action !== 'restart' && command.args[0] === 'bootout'

const resolveRootWithPrompt = async (
  root: string | undefined,
  yes: boolean,
  cwd: string,
  prompt: ServicePrompt
) => {
  if (root) {
    const resolvedRoot = resolve(root)
    ensureExistingDirectory(resolvedRoot)
    return resolvedRoot
  }

  const defaultRoot = detectRootPromptDefault(cwd)
  if (yes) {
    if (!defaultRoot.value) {
      throw new CodoriError(
        'MISSING_ROOT',
        'Project root is required. Pass --root or run interactively from a likely project root.'
      )
    }

    ensureExistingDirectory(defaultRoot.value)
    return defaultRoot.value
  }

  if (defaultRoot.value) {
    const useDefault = await prompt.confirm(`Use ${defaultRoot.value} as the project root`, true)
    if (useDefault) {
      ensureExistingDirectory(defaultRoot.value)
      return defaultRoot.value
    }
  }

  const answer = await prompt.input('Project root directory', defaultRoot.value ?? undefined)
  if (!answer) {
    throw new CodoriError('MISSING_ROOT', 'Project root is required.')
  }

  const resolvedRoot = resolve(answer)
  ensureExistingDirectory(resolvedRoot)
  return resolvedRoot
}

const resolvePromptedScope = async (
  scope: string | undefined,
  yes: boolean,
  prompt: ServicePrompt
): Promise<ServiceScope> => {
  if (scope || yes) {
    return resolveServiceScope(scope)
  }

  return resolveServiceScope(await prompt.input('Service scope', 'user'))
}

const resolvePromptedPort = async (
  port: string | number | undefined,
  yes: boolean,
  prompt: ServicePrompt
) => {
  const explicitPort = parseServicePort(port)
  if (explicitPort !== undefined || yes) {
    return resolveDefaultServicePort(explicitPort)
  }

  const answer = await prompt.input('Port for the Codori server', String(DEFAULT_SERVER_PORT))
  return resolveDefaultServicePort(parseServicePort(answer))
}

const resolvePromptedHost = async (
  host: string | undefined,
  yes: boolean,
  prompt: ServicePrompt,
  runCommand: CommandRunner,
  stdout: NodeJS.WritableStream
) => {
  const hostDefault = await resolveHostPromptDefault(host, runCommand)
  if (hostDefault.warning) {
    writeLine(stdout, `Warning: ${hostDefault.warning}`)
  }

  if (host || yes) {
    return hostDefault.value
  }

  const answer = await prompt.input('Host to bind Codori', hostDefault.value)
  return answer || hostDefault.value
}

const writeLauncherAndServiceFiles = (
  metadata: Pick<ServiceInstallMetadata, 'installId' | 'root' | 'host' | 'port' | 'scope' | 'platform'>,
  definition: ServiceUnitDefinition,
  homeDir: string,
  nodePath: string,
  npxPath: string
) => {
  const metadataDirectory = getServiceMetadataDirectory(metadata.installId, homeDir)
  const launcherPath = getServiceLauncherPath(metadata.installId, homeDir)

  ensureDirectory(metadataDirectory)
  ensureDirectory(dirname(definition.serviceFilePath))

  const launcherScript = buildLauncherScript({
    installId: metadata.installId,
    root: metadata.root,
    host: metadata.host,
    port: metadata.port,
    scope: metadata.scope,
    nodePath,
    npxPath
  })

  writeFileSync(launcherPath, `${launcherScript}\n`, 'utf8')
  chmodSync(launcherPath, 0o755)
  writeFileSync(definition.serviceFilePath, `${definition.serviceFileContents}\n`, 'utf8')
}

const writeServiceMetadata = (metadata: ServiceInstallMetadata, homeDir: string) => {
  const metadataPath = getServiceMetadataPath(metadata.installId, homeDir)
  ensureDirectory(dirname(metadataPath))
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
}

const printInstallSummary = (
  stdout: NodeJS.WritableStream,
  summary: {
    root: string
    host: string
    port: number
    scope: ServiceScope
    serviceFilePath: string
    launcherPath: string
  }
) => {
  writeLine(stdout, 'Service installation summary:')
  writeLine(stdout, `  root: ${summary.root}`)
  writeLine(stdout, `  host: ${summary.host}`)
  writeLine(stdout, `  port: ${summary.port}`)
  writeLine(stdout, `  scope: ${summary.scope}`)
  writeLine(stdout, `  launcher: ${summary.launcherPath}`)
  writeLine(stdout, `  service file: ${summary.serviceFilePath}`)
}

const createOperationMetadata = (
  installId: string,
  action: 'install' | 'restart',
  values: {
    root: string
    host: string
    port: number
    scope: ServiceScope
    platform: ServicePlatform
    definition: ServiceUnitDefinition
    homeDir: string
  },
  now: () => Date,
  previousMetadata?: ServiceInstallMetadata
): ServiceInstallMetadata => ({
  installId,
  root: values.root,
  host: values.host,
  port: values.port,
  scope: values.scope,
  platform: values.platform,
  serviceName: values.definition.serviceName,
  serviceFilePath: values.definition.serviceFilePath,
  launcherPath: getServiceLauncherPath(installId, values.homeDir),
  installedAt: action === 'install'
    ? now().toISOString()
    : previousMetadata?.installedAt ?? now().toISOString()
})

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
  installId,
  root,
  host,
  port,
  scope,
  nodePath,
  npxPath
}: LauncherScriptInput) => {
  const pathEntries = Array.from(new Set([dirname(nodePath), dirname(npxPath)]))
  const exportPath = `${pathEntries.map(shellEscape).join(':')}:$PATH`

  return [
    '#!/bin/sh',
    'set -eu',
    `export PATH=${exportPath}`,
    `export ${CODORI_SERVICE_MANAGED_ENV}=1`,
    `export ${CODORI_SERVICE_INSTALL_ID_ENV}=${shellEscape(installId)}`,
    `export ${CODORI_SERVICE_SCOPE_ENV}=${shellEscape(scope)}`,
    `exec ${shellEscape(npxPath)} --yes @codori/server serve --root ${shellEscape(resolve(root))} --host ${shellEscape(host)} --port ${port}`
  ].join('\n')
}

export const installService = async (
  options: ServiceCommandOptions = {},
  dependencies: ServiceCommandDependencies = {}
): Promise<ServiceOperationResult> => {
  const runCommand = dependencies.runCommand ?? defaultCommandRunner
  const stdout = dependencies.stdout ?? process.stdout
  const cwd = dependencies.cwd ?? process.cwd()
  const homeDir = dependencies.homeDir ?? os.homedir()
  const nodePath = dependencies.nodePath ?? process.execPath
  const npxPath = dependencies.npxPath ?? join(dirname(nodePath), 'npx')
  const platform = resolveServicePlatform(dependencies.platform)
  const now = dependencies.now ?? (() => new Date())
  const prompt = dependencies.prompt ?? createDefaultPrompt(
    (dependencies.stdin ?? process.stdin) as typeof process.stdin,
    stdout as typeof process.stdout
  )
  const yes = options.yes ?? false

  try {
    const root = await resolveRootWithPrompt(options.root, yes, cwd, prompt)
    const host = await resolvePromptedHost(options.host, yes, prompt, runCommand, stdout)
    const port = await resolvePromptedPort(options.port, yes, prompt)
    const scope = await resolvePromptedScope(options.scope, yes, prompt)
    ensureSystemScopePrivileges(scope, 'install-service', {
      root,
      host,
      port,
      scope,
      yes
    })

    if (platform === 'linux') {
      await ensureLinuxServiceManager(scope, runCommand)
    }

    const installId = toServiceInstallId(root)
    const definition = resolveServiceDefinition({
      installId,
      scope,
      root,
      platform
    }, homeDir)

    printInstallSummary(stdout, {
      root,
      host,
      port,
      scope,
      launcherPath: getServiceLauncherPath(installId, homeDir),
      serviceFilePath: definition.serviceFilePath
    })

    if (!yes) {
      const confirmed = await prompt.confirm('Install this service now', true)
      if (!confirmed) {
        throw new CodoriError('SERVICE_ABORTED', 'Service installation was cancelled.')
      }
    }

    const metadata = createOperationMetadata(installId, 'install', {
      root,
      host,
      port,
      scope,
      platform,
      definition,
      homeDir
    }, now)

    writeLauncherAndServiceFiles(metadata, definition, homeDir, nodePath, npxPath)
    await runCommandSequence(
      resolveServiceCommands('install', metadata, definition),
      runCommand,
      (command, result) => shouldIgnoreCommandFailure('install', metadata, command) && result.exitCode !== 0
    )
    writeServiceMetadata(metadata, homeDir)

    return {
      action: 'install',
      metadata
    }
  } finally {
    if (!dependencies.prompt) {
      await prompt.close()
    }
  }
}

export const restartService = async (
  options: ServiceCommandOptions = {},
  dependencies: ServiceCommandDependencies = {}
): Promise<ServiceOperationResult> => {
  const runCommand = dependencies.runCommand ?? defaultCommandRunner
  const cwd = dependencies.cwd ?? process.cwd()
  const homeDir = dependencies.homeDir ?? os.homedir()
  const nodePath = dependencies.nodePath ?? process.execPath
  const npxPath = dependencies.npxPath ?? join(dirname(nodePath), 'npx')
  const prompt = dependencies.prompt ?? createDefaultPrompt(
    (dependencies.stdin ?? process.stdin) as typeof process.stdin,
    (dependencies.stdout ?? process.stdout) as typeof process.stdout
  )
  const yes = options.yes ?? false

  try {
    const root = await resolveRootWithPrompt(options.root, yes, cwd, prompt)
    const metadata = loadServiceMetadata(root, homeDir)
    if (options.scope) {
      const requestedScope = resolveServiceScope(options.scope)
      if (requestedScope !== metadata.scope) {
        throw new CodoriError(
          'SERVICE_SCOPE_MISMATCH',
          `Installed scope is ${metadata.scope}, not ${requestedScope}.`
        )
      }
    }

    ensureSystemScopePrivileges(metadata.scope, 'restart-service', {
      root: metadata.root,
      scope: metadata.scope,
      yes
    })

    if (metadata.platform === 'linux') {
      await ensureLinuxServiceManager(metadata.scope, runCommand)
    }

    const definition = resolveServiceDefinition(metadata, homeDir)
    writeLauncherAndServiceFiles(metadata, definition, homeDir, nodePath, npxPath)
    await runCommandSequence(resolveServiceCommands('restart', metadata, definition), runCommand)

    return {
      action: 'restart',
      metadata
    }
  } finally {
    if (!dependencies.prompt) {
      await prompt.close()
    }
  }
}

export const uninstallService = async (
  options: ServiceCommandOptions = {},
  dependencies: ServiceCommandDependencies = {}
): Promise<ServiceOperationResult> => {
  const runCommand = dependencies.runCommand ?? defaultCommandRunner
  const cwd = dependencies.cwd ?? process.cwd()
  const homeDir = dependencies.homeDir ?? os.homedir()
  const prompt = dependencies.prompt ?? createDefaultPrompt(
    (dependencies.stdin ?? process.stdin) as typeof process.stdin,
    (dependencies.stdout ?? process.stdout) as typeof process.stdout
  )
  const yes = options.yes ?? false

  try {
    const root = await resolveRootWithPrompt(options.root, yes, cwd, prompt)
    const metadata = loadServiceMetadata(root, homeDir)
    ensureSystemScopePrivileges(metadata.scope, 'uninstall-service', {
      root: metadata.root,
      scope: metadata.scope,
      yes
    })

    if (!yes) {
      const confirmed = await prompt.confirm(`Remove the service for ${metadata.root}`, true)
      if (!confirmed) {
        throw new CodoriError('SERVICE_ABORTED', 'Service removal was cancelled.')
      }
    }

    if (metadata.platform === 'linux') {
      await ensureLinuxServiceManager(metadata.scope, runCommand)
    }

    const definition = resolveServiceDefinition(metadata, homeDir)
    const commands = resolveServiceCommands('uninstall', metadata, definition)
    if (commands.length > 0) {
      const [first, ...rest] = commands
      await runCommandSequence(
        [first],
        runCommand,
        (command, result) => shouldIgnoreCommandFailure('uninstall', metadata, command) && result.exitCode !== 0
      )
      rmSync(definition.serviceFilePath, { force: true })
      await runCommandSequence(rest, runCommand)
      rmSync(getServiceMetadataDirectory(metadata.installId, homeDir), { recursive: true, force: true })
    }

    return {
      action: 'uninstall',
      metadata
    }
  } finally {
    if (!dependencies.prompt) {
      await prompt.close()
    }
  }
}

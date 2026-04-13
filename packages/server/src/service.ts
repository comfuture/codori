import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
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

const WORKSPACE_MARKER_NAMES = [
  'package.json',
  'pnpm-workspace.yaml',
  'turbo.json'
]

const SUPPORTED_SERVICE_SCOPES = new Set<ServiceScope>(['user', 'system'])

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

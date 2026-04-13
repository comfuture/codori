import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CodoriError } from './errors.js'
import {
  CODORI_SERVICE_INSTALL_ID_ENV,
  CODORI_SERVICE_MANAGED_ENV,
  CODORI_SERVICE_SCOPE_ENV,
  getServiceMetadataDirectory,
  type ServiceScope
} from './service.js'

export type ServiceUpdateStatus = {
  enabled: boolean
  updateAvailable: boolean
  updating: boolean
  installedVersion: string | null
  latestVersion: string | null
}

export type ServiceUpdateController = {
  getStatus: () => Promise<ServiceUpdateStatus>
  requestUpdate: () => Promise<ServiceUpdateStatus>
}

export type ServiceUpdateControllerOptions = {
  root: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
  now?: () => number
  npxPath?: string
  fetchImpl?: typeof fetch
  cacheTtlMs?: number
  registryTimeoutMs?: number
  spawnUpdateProcess?: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => Promise<void>
}

type PackageManifest = {
  name: string
  version: string
}

type ServiceRuntimeContext = {
  installId: string
  scope: ServiceScope
}

const PACKAGE_MANIFEST_PATH = fileURLToPath(new URL('../package.json', import.meta.url))
const UPDATE_CHECK_TTL_MS = 5 * 60 * 1_000
const REGISTRY_TIMEOUT_MS = 3_000

const shellEscape = (value: string) => `'${value.replaceAll("'", "'\"'\"'")}'`

const readPackageManifest = (): PackageManifest => {
  const parsed: unknown = JSON.parse(readFileSync(PACKAGE_MANIFEST_PATH, 'utf8'))
  if (
    typeof parsed !== 'object'
    || parsed === null
    || typeof (parsed as { name?: unknown }).name !== 'string'
    || typeof (parsed as { version?: unknown }).version !== 'string'
  ) {
    throw new Error(`Invalid package manifest at ${PACKAGE_MANIFEST_PATH}.`)
  }

  return {
    name: (parsed as { name: string }).name,
    version: (parsed as { version: string }).version
  }
}

const CURRENT_PACKAGE = readPackageManifest()

const DISABLED_STATUS: ServiceUpdateStatus = {
  enabled: false,
  updateAvailable: false,
  updating: false,
  installedVersion: null,
  latestVersion: null
}

const coerceVersionPart = (value: string) => {
  if (/^\d+$/u.test(value)) {
    return Number.parseInt(value, 10)
  }

  return value
}

export const comparePackageVersions = (left: string, right: string) => {
  const maxLength = Math.max(left.split('.').length, right.split('.').length)
  const leftParts = left.split('.').map(coerceVersionPart)
  const rightParts = right.split('.').map(coerceVersionPart)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart === rightPart) {
      continue
    }

    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart > rightPart ? 1 : -1
    }

    return String(leftPart).localeCompare(String(rightPart), undefined, { numeric: true })
  }

  return 0
}

const resolveServiceRuntimeContext = (env: NodeJS.ProcessEnv): ServiceRuntimeContext | null => {
  if (env[CODORI_SERVICE_MANAGED_ENV] !== '1') {
    return null
  }

  const installId = env[CODORI_SERVICE_INSTALL_ID_ENV]?.trim()
  const scope = env[CODORI_SERVICE_SCOPE_ENV]?.trim()
  if (!installId || (scope !== 'user' && scope !== 'system')) {
    return null
  }

  return {
    installId,
    scope
  }
}

const fetchLatestPackageVersion = async (
  fetchImpl: typeof fetch,
  registryTimeoutMs: number
) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    controller.abort()
  }, registryTimeoutMs)

  let response: Response
  try {
    response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(CURRENT_PACKAGE.name)}/latest`, {
      headers: {
        accept: 'application/json'
      },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    throw new Error(`npm registry request failed with status ${response.status}.`)
  }

  const payload: unknown = await response.json()
  if (typeof payload !== 'object' || payload === null || typeof (payload as { version?: unknown }).version !== 'string') {
    throw new Error('npm registry response did not include a valid version.')
  }

  return (payload as { version: string }).version
}

const createUpdateScript = (
  runtime: ServiceRuntimeContext,
  options: {
    root: string
    npxPath: string
    homeDir: string
  }
) => {
  const metadataDirectory = getServiceMetadataDirectory(runtime.installId, options.homeDir)
  const updateLogPath = join(metadataDirectory, 'update.log')

  return [
    'sleep 1',
    `${shellEscape(options.npxPath)} --yes ${shellEscape(`${CURRENT_PACKAGE.name}@latest`)} restart-service --root ${shellEscape(options.root)} --scope ${shellEscape(runtime.scope)} --yes >> ${shellEscape(updateLogPath)} 2>&1`
  ].join('; ')
}

const defaultSpawnUpdateProcess = async (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv }
) => {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      detached: true,
      env: options.env,
      stdio: 'ignore',
      windowsHide: true
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolvePromise()
    })
  })
}

export const createServiceUpdateController = (
  options: ServiceUpdateControllerOptions
): ServiceUpdateController => {
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? os.homedir()
  const npxPath = options.npxPath ?? join(dirname(process.execPath), 'npx')
  const now = options.now ?? (() => Date.now())
  const fetchImpl = options.fetchImpl ?? fetch
  const cacheTtlMs = options.cacheTtlMs ?? UPDATE_CHECK_TTL_MS
  const registryTimeoutMs = options.registryTimeoutMs ?? REGISTRY_TIMEOUT_MS
  const spawnUpdateProcess = options.spawnUpdateProcess ?? defaultSpawnUpdateProcess
  const runtime = resolveServiceRuntimeContext(env)

  let updating = false
  let cachedStatus: ServiceUpdateStatus | null = null
  let cachedAt = 0
  let pendingStatus: Promise<ServiceUpdateStatus> | null = null

  const resolveStatus = async () => {
    if (!runtime) {
      return DISABLED_STATUS
    }

    if (pendingStatus) {
      return pendingStatus
    }

    if (cachedStatus && now() - cachedAt < cacheTtlMs) {
      return {
        ...cachedStatus,
        updating
      }
    }

    pendingStatus = (async () => {
      let latestVersion: string | null = cachedStatus?.latestVersion ?? null
      try {
        latestVersion = await fetchLatestPackageVersion(fetchImpl, registryTimeoutMs)
      } catch {
        latestVersion = cachedStatus?.latestVersion ?? null
      }

      const nextStatus: ServiceUpdateStatus = {
        enabled: true,
        updateAvailable: latestVersion !== null && comparePackageVersions(latestVersion, CURRENT_PACKAGE.version) > 0,
        updating,
        installedVersion: CURRENT_PACKAGE.version,
        latestVersion
      }

      cachedStatus = nextStatus
      cachedAt = now()
      pendingStatus = null
      return nextStatus
    })()

    return pendingStatus
  }

  return {
    getStatus: async () => await resolveStatus(),
    requestUpdate: async () => {
      if (!runtime) {
        throw new CodoriError(
          'SERVICE_UPDATE_UNAVAILABLE',
          'Self-update is only available while Codori is running as a registered service.'
        )
      }

      if (updating) {
        throw new CodoriError(
          'SERVICE_UPDATE_IN_PROGRESS',
          'Codori is already applying a service update.'
        )
      }

      const status = await resolveStatus()
      if (!status.updateAvailable) {
        throw new CodoriError(
          'SERVICE_UPDATE_UNAVAILABLE',
          'No newer @codori/server package is currently available.'
        )
      }

      const script = createUpdateScript(runtime, {
        root: options.root,
        npxPath,
        homeDir
      })

      await spawnUpdateProcess('/bin/sh', ['-lc', script], { env })
      updating = true

      cachedStatus = {
        ...status,
        updating: true
      }
      cachedAt = now()

      return cachedStatus
    }
  }
}

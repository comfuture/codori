import { spawn } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CodoriError } from './errors.js'
import {
  CODORI_SERVICE_HOME_ENV,
  CODORI_SERVICE_INSTALL_ID_ENV,
  CODORI_SERVICE_MANAGED_ENV,
  CODORI_SERVICE_SCOPE_ENV,
  getServiceMetadataDirectory,
  loadServiceMetadataByInstallId,
  restartService,
  writeServiceMetadataAtomic,
  writeServiceRuntimeFiles,
  type ServiceInstallMetadata,
  type ServiceScope,
  type ServiceUpdatePhase
} from './service.js'
import {
  activateServiceBundleSelection,
  cleanupServiceBundles,
  prepareServiceBundle,
  readServiceBundleSelection,
  type PrepareServiceBundle
} from './service-bundle.js'

export type ServiceUpdateStatus = {
  enabled: boolean
  updateAvailable: boolean
  updating: boolean
  installedVersion: string | null
  latestVersion: string | null
  durableVersion: string | null
  phase: ServiceUpdatePhase | null
  failureReason: string | null
}

export type ServiceUpdateController = {
  getStatus: () => Promise<ServiceUpdateStatus>
  requestUpdate: () => Promise<ServiceUpdateStatus>
  startPolling: () => void
  stopPolling: () => void
}

export type ServiceUpdateControllerOptions = {
  root: string
  env?: NodeJS.ProcessEnv
  homeDir?: string
  now?: () => number
  nodePath?: string
  fetchImpl?: typeof fetch
  cacheTtlMs?: number
  registryTimeoutMs?: number
  platform?: NodeJS.Platform
  pollIntervalMs?: number
  spawnUpdateProcess?: (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => Promise<void>
}

type PackageManifest = { name: string, version: string }
type ServiceRuntimeContext = { installId: string, scope: ServiceScope }

const PACKAGE_MANIFEST_PATH = fileURLToPath(new URL('../package.json', import.meta.url))
const UPDATE_WORKER_PATH = fileURLToPath(new URL('./service-update-worker.js', import.meta.url))
const UPDATE_CHECK_TTL_MS = 5 * 60 * 1_000
const REGISTRY_TIMEOUT_MS = 3_000
const UPDATE_POLL_INTERVAL_MS = 60 * 60 * 1_000
export const DEFAULT_UPDATE_HEALTH_TIMEOUT_MS = 30_000
export const DEFAULT_UPDATE_PREPARATION_TIMEOUT_MS = 2 * 60 * 1_000

/** Retained for compatibility with launchers produced before durable bundles. */
export const CODORI_STARTUP_UPDATE_APPLIED_ENV = 'CODORI_STARTUP_UPDATE_APPLIED'

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
    name: (parsed as PackageManifest).name,
    version: (parsed as PackageManifest).version
  }
}

const CURRENT_PACKAGE = readPackageManifest()
export const getCurrentServerPackage = () => ({ ...CURRENT_PACKAGE })

const DISABLED_STATUS: ServiceUpdateStatus = {
  enabled: false,
  updateAvailable: false,
  updating: false,
  installedVersion: null,
  latestVersion: null,
  durableVersion: null,
  phase: null,
  failureReason: null
}

const coerceVersionPart = (value: string) => /^\d+$/u.test(value)
  ? Number.parseInt(value, 10)
  : value

export const comparePackageVersions = (left: string, right: string) => {
  const maxLength = Math.max(left.split('.').length, right.split('.').length)
  const leftParts = left.split('.').map(coerceVersionPart)
  const rightParts = right.split('.').map(coerceVersionPart)
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart === rightPart) continue
    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart > rightPart ? 1 : -1
    }
    return String(leftPart).localeCompare(String(rightPart), undefined, { numeric: true })
  }
  return 0
}

const resolveServiceRuntimeContext = (env: NodeJS.ProcessEnv): ServiceRuntimeContext | null => {
  if (env[CODORI_SERVICE_MANAGED_ENV] !== '1') return null
  const installId = env[CODORI_SERVICE_INSTALL_ID_ENV]?.trim()
  const scope = env[CODORI_SERVICE_SCOPE_ENV]?.trim()
  if (!installId || (scope !== 'user' && scope !== 'system')) return null
  return { installId, scope }
}

const fetchLatestPackageVersion = async (fetchImpl: typeof fetch, registryTimeoutMs: number) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), registryTimeoutMs)
  let response: Response
  try {
    response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(CURRENT_PACKAGE.name)}/latest`, {
      headers: { accept: 'application/json' },
      signal: controller.signal
    })
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) throw new Error(`npm registry request failed with status ${response.status}.`)
  const payload: unknown = await response.json()
  if (typeof payload !== 'object' || payload === null || typeof (payload as { version?: unknown }).version !== 'string') {
    throw new Error('npm registry response did not include a valid version.')
  }
  return (payload as { version: string }).version
}

export const createUpdateCommand = (
  runtime: ServiceRuntimeContext,
  options: {
    root: string
    nodePath: string
    homeDir: string
    platform: NodeJS.Platform
    targetVersion: string
  }
): { command: string, args: string[] } => ({
  command: options.nodePath,
  args: [
    UPDATE_WORKER_PATH,
    '--install-id', runtime.installId,
    '--root', options.root,
    '--scope', runtime.scope,
    '--home', options.homeDir,
    '--target-version', options.targetVersion
  ]
})

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

export type StartupUpdateResult = {
  checked: boolean
  installedVersion: string
  latestVersion: string | null
  updateAvailable: boolean
  adopted: boolean
  reason: 'not-service-managed' | 'durable-launch'
}

export type StartupUpdateOptions = {
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  registryTimeoutMs?: number
  execPackage?: (specifier: string) => Promise<void>
}

/** Ordinary service starts never contact npm or launch a nested package install. */
export const checkStartupUpdate = async (
  options: StartupUpdateOptions = {}
): Promise<StartupUpdateResult> => {
  const runtime = resolveServiceRuntimeContext(options.env ?? process.env)
  return {
    checked: false,
    installedVersion: CURRENT_PACKAGE.version,
    latestVersion: null,
    updateAvailable: false,
    adopted: false,
    reason: runtime ? 'durable-launch' : 'not-service-managed'
  }
}

const readDurableState = (runtime: ServiceRuntimeContext, homeDir: string) => {
  try {
    return loadServiceMetadataByInstallId(runtime.installId, homeDir)
  } catch {
    return null
  }
}

const isUpdatingPhase = (phase: ServiceUpdatePhase | undefined) =>
  phase === 'downloading' || phase === 'restarting'

export const createServiceUpdateController = (
  options: ServiceUpdateControllerOptions
): ServiceUpdateController => {
  const env = options.env ?? process.env
  const homeDir = options.homeDir ?? env[CODORI_SERVICE_HOME_ENV]?.trim() ?? os.homedir()
  const nodePath = options.nodePath ?? process.execPath
  const now = options.now ?? (() => Date.now())
  const fetchImpl = options.fetchImpl ?? fetch
  const cacheTtlMs = options.cacheTtlMs ?? UPDATE_CHECK_TTL_MS
  const registryTimeoutMs = options.registryTimeoutMs ?? REGISTRY_TIMEOUT_MS
  const platform = options.platform ?? process.platform
  const pollIntervalMs = options.pollIntervalMs ?? UPDATE_POLL_INTERVAL_MS
  const spawnUpdateProcess = options.spawnUpdateProcess ?? defaultSpawnUpdateProcess
  const runtime = resolveServiceRuntimeContext(env)

  let cachedLatestVersion: string | null = null
  let cachedAt = 0
  let pendingLatestVersion: Promise<string | null> | null = null
  let pollTimer: NodeJS.Timeout | null = null

  const resolveLatestVersion = async () => {
    if (pendingLatestVersion) return pendingLatestVersion
    if (cachedAt > 0 && now() - cachedAt < cacheTtlMs) return cachedLatestVersion
    pendingLatestVersion = fetchLatestPackageVersion(fetchImpl, registryTimeoutMs)
      .catch(() => cachedLatestVersion)
      .then((version) => {
        cachedLatestVersion = version
        cachedAt = now()
        pendingLatestVersion = null
        return version
      })
    return pendingLatestVersion
  }

  const resolveStatus = async (): Promise<ServiceUpdateStatus> => {
    if (!runtime) return DISABLED_STATUS
    const metadata = readDurableState(runtime, homeDir)
    const phase = metadata?.updateState?.phase ?? 'idle'
    // During a handoff this endpoint is also the readiness probe. Never make
    // exact-version health wait on the registry that was just used to stage the
    // bundle; the target is already durable metadata at this point.
    const latestVersion = isUpdatingPhase(phase)
      ? metadata?.updateState?.targetVersion ?? cachedLatestVersion
      : await resolveLatestVersion()
    const durableVersion = readServiceBundleSelection(
      getServiceMetadataDirectory(runtime.installId, homeDir)
    )?.version ?? metadata?.activeBundle?.version ?? CURRENT_PACKAGE.version
    return {
      enabled: true,
      updateAvailable: latestVersion !== null && comparePackageVersions(latestVersion, durableVersion) > 0,
      updating: isUpdatingPhase(phase),
      installedVersion: CURRENT_PACKAGE.version,
      latestVersion,
      durableVersion,
      phase,
      failureReason: metadata?.updateState?.failureReason ?? null
    }
  }

  const persistState = (phase: ServiceUpdatePhase, targetVersion: string, failureReason: string | null) => {
    if (!runtime) return
    const metadata = loadServiceMetadataByInstallId(runtime.installId, homeDir)
    writeServiceMetadataAtomic({
      ...metadata,
      updateState: {
        phase,
        targetVersion,
        activeVersion: metadata.activeBundle?.version ?? CURRENT_PACKAGE.version,
        failureReason,
        updatedAt: new Date(now()).toISOString()
      }
    }, homeDir)
  }

  return {
    getStatus: resolveStatus,
    startPolling: () => {
      if (!runtime || pollTimer) return
      pollTimer = setInterval(() => {
        cachedAt = 0
        void resolveLatestVersion().catch(() => {})
      }, pollIntervalMs)
      pollTimer.unref?.()
    },
    stopPolling: () => {
      if (!pollTimer) return
      clearInterval(pollTimer)
      pollTimer = null
    },
    requestUpdate: async () => {
      if (!runtime) {
        throw new CodoriError('SERVICE_UPDATE_UNAVAILABLE', 'Self-update is only available while Codori is running as a registered service.')
      }
      const current = await resolveStatus()
      if (current.updating) {
        throw new CodoriError('SERVICE_UPDATE_IN_PROGRESS', 'Codori is already applying a service update.')
      }
      if (!current.updateAvailable || !current.latestVersion) {
        throw new CodoriError('SERVICE_UPDATE_UNAVAILABLE', 'No newer @codori/server package is currently available.')
      }

      persistState('downloading', current.latestVersion, null)
      const updateCommand = createUpdateCommand(runtime, {
        root: options.root,
        nodePath,
        homeDir,
        platform,
        targetVersion: current.latestVersion
      })
      try {
        await spawnUpdateProcess(updateCommand.command, updateCommand.args, { env })
      } catch (error) {
        persistState('failed', current.latestVersion, error instanceof Error ? error.message : String(error))
        throw error
      }
      return await resolveStatus()
    }
  }
}

export type ServiceUpdateTransactionOptions = {
  installId: string
  root: string
  scope: ServiceScope
  homeDir: string
  targetVersion: string
  nodePath?: string
  npmPath?: string
  preparationTimeoutMs?: number
  healthTimeoutMs?: number
  healthPollIntervalMs?: number
}

export type ServiceUpdateTransactionDependencies = {
  prepareBundle?: PrepareServiceBundle
  restart?: (metadata: ServiceInstallMetadata) => Promise<void>
  fetchImpl?: typeof fetch
  now?: () => Date
  delay?: (milliseconds: number) => Promise<void>
}

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, message: string) => await new Promise<T>((resolvePromise, reject) => {
  const timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  promise.then(
    value => { clearTimeout(timer); resolvePromise(value) },
    error => { clearTimeout(timer); reject(error) }
  )
})

const healthUrl = (metadata: ServiceInstallMetadata) => {
  const host = metadata.host === '0.0.0.0' || metadata.host === '::' ? '127.0.0.1' : metadata.host
  return `http://${host.includes(':') ? `[${host}]` : host}:${metadata.port}/api/service/update`
}

const waitForExactVersion = async (
  metadata: ServiceInstallMetadata,
  targetVersion: string,
  options: { fetchImpl: typeof fetch, timeoutMs: number, pollIntervalMs: number, now: () => Date, delay: (ms: number) => Promise<void> }
) => {
  const deadline = options.now().getTime() + options.timeoutMs
  let lastReason: string
  do {
    try {
      const response = await options.fetchImpl(healthUrl(metadata), {
        signal: AbortSignal.timeout(Math.min(2_000, options.timeoutMs))
      })
      if (response.ok) {
        const payload = await response.json() as { serviceUpdate?: { installedVersion?: unknown, durableVersion?: unknown } }
        const installedVersion = payload.serviceUpdate?.installedVersion
        const durableVersion = payload.serviceUpdate?.durableVersion
        if (installedVersion === targetVersion && (durableVersion === undefined || durableVersion === targetVersion)) return
        lastReason = `service reported ${String(installedVersion)} (durable ${String(durableVersion)})`
      } else {
        lastReason = `health endpoint returned ${response.status}`
      }
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error)
    }
    await options.delay(options.pollIntervalMs)
  } while (options.now().getTime() < deadline)
  throw new Error(`Timed out waiting for ${CURRENT_PACKAGE.name}@${targetVersion}: ${lastReason}.`)
}

export const runServiceUpdateTransaction = async (
  options: ServiceUpdateTransactionOptions,
  dependencies: ServiceUpdateTransactionDependencies = {}
) => {
  const now = dependencies.now ?? (() => new Date())
  const delay = dependencies.delay ?? (async milliseconds => await new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds)))
  const nodePath = options.nodePath ?? process.execPath
  const npmPath = options.npmPath ?? join(dirname(nodePath), process.platform === 'win32' ? 'npm.cmd' : 'npm')
  const preparationTimeoutMs = options.preparationTimeoutMs ?? DEFAULT_UPDATE_PREPARATION_TIMEOUT_MS
  const healthTimeoutMs = options.healthTimeoutMs ?? DEFAULT_UPDATE_HEALTH_TIMEOUT_MS
  const metadataDirectory = getServiceMetadataDirectory(options.installId, options.homeDir)
  const prepareBundle = dependencies.prepareBundle ?? prepareServiceBundle
  const fetchImpl = dependencies.fetchImpl ?? fetch
  const originalMetadata = loadServiceMetadataByInstallId(options.installId, options.homeDir)
  if (originalMetadata.root !== options.root || originalMetadata.scope !== options.scope) {
    throw new Error('Service update worker arguments do not match the registered service metadata.')
  }

  const writeState = (metadata: ServiceInstallMetadata, phase: ServiceUpdatePhase, failureReason: string | null) => {
    const next: ServiceInstallMetadata = {
      ...metadata,
      updateState: {
        phase,
        targetVersion: options.targetVersion,
        activeVersion: metadata.activeBundle?.version ?? null,
        failureReason,
        updatedAt: now().toISOString()
      }
    }
    writeServiceMetadataAtomic(next, options.homeDir)
    try {
      appendFileSync(join(metadataDirectory, 'update.log'), `${JSON.stringify({
        timestamp: next.updateState?.updatedAt,
        phase,
        targetVersion: options.targetVersion,
        activeVersion: next.updateState?.activeVersion,
        failureReason
      })}\n`, 'utf8')
    } catch {
      // Status persistence remains authoritative when optional diagnostics fail.
    }
    return next
  }

  let previous = readServiceBundleSelection(metadataDirectory) ?? originalMetadata.activeBundle ?? null
  const needsLauncherMigration = previous === null
  let transactionMetadata = writeState(originalMetadata, 'downloading', null)
  try {
    if (!previous) {
      previous = await withTimeout(prepareBundle({
        metadataDirectory,
        version: CURRENT_PACKAGE.version,
        nodePath,
        npmPath,
        timeoutMs: preparationTimeoutMs,
        now
      }), preparationTimeoutMs, `Timed out preparing rollback bundle ${CURRENT_PACKAGE.version}.`)
    }
    const target = await withTimeout(prepareBundle({
      metadataDirectory,
      version: options.targetVersion,
      nodePath,
      npmPath,
      timeoutMs: preparationTimeoutMs,
      now
    }), preparationTimeoutMs, `Timed out preparing target bundle ${options.targetVersion}.`)

    if (needsLauncherMigration) {
      activateServiceBundleSelection(metadataDirectory, previous)
      transactionMetadata = writeState({
        ...transactionMetadata,
        activeBundle: previous
      }, 'downloading', null)
      writeServiceRuntimeFiles(transactionMetadata, options.homeDir, nodePath)
    }
    activateServiceBundleSelection(metadataDirectory, target, previous)
    transactionMetadata = writeState({
      ...transactionMetadata,
      activeBundle: target,
      previousBundle: previous
    }, 'restarting', null)

    const restart = dependencies.restart ?? (async (metadata) => {
      await restartService({ root: metadata.root, scope: metadata.scope, yes: true }, {
        homeDir: options.homeDir,
        nodePath,
        npmPath
      })
    })
    await restart(transactionMetadata)
    await waitForExactVersion(transactionMetadata, options.targetVersion, {
      fetchImpl,
      timeoutMs: healthTimeoutMs,
      pollIntervalMs: options.healthPollIntervalMs ?? 250,
      now,
      delay
    })
    transactionMetadata = writeState(transactionMetadata, 'healthy', null)
    cleanupServiceBundles(metadataDirectory, [target.version, previous.version])
    return transactionMetadata
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    if (!previous || !transactionMetadata.activeBundle || transactionMetadata.activeBundle.version === previous.version) {
      writeState(transactionMetadata, 'failed', reason)
      throw error
    }
    activateServiceBundleSelection(metadataDirectory, previous, transactionMetadata.activeBundle)
    const rollbackMetadata = writeState({
      ...transactionMetadata,
      activeBundle: previous,
      previousBundle: transactionMetadata.activeBundle
    }, 'restarting', reason)
    try {
      const restart = dependencies.restart ?? (async (metadata) => {
        await restartService({ root: metadata.root, scope: metadata.scope, yes: true }, {
          homeDir: options.homeDir,
          nodePath,
          npmPath
        })
      })
      await restart(rollbackMetadata)
      await waitForExactVersion(rollbackMetadata, previous.version, {
        fetchImpl,
        timeoutMs: healthTimeoutMs,
        pollIntervalMs: options.healthPollIntervalMs ?? 250,
        now,
        delay
      })
      const rolledBack = writeState(rollbackMetadata, 'rolled-back', reason)
      cleanupServiceBundles(metadataDirectory, [previous.version, transactionMetadata.activeBundle.version])
      return rolledBack
    } catch (rollbackError) {
      const rollbackReason = rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      writeState(rollbackMetadata, 'failed', `${reason}; rollback failed: ${rollbackReason}`)
      throw rollbackError
    }
  }
}

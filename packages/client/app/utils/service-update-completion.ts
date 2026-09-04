import type { ServiceUpdateStatus } from '~~/shared/codori'

export const SERVICE_UPDATE_COMPLETION_POLL_INTERVAL_MS = 1_000
export const SERVICE_UPDATE_COMPLETION_TIMEOUT_MS = 5 * 60 * 1_000

type ServiceUpdateCompletionMonitorOptions = {
  refreshStatus: () => Promise<ServiceUpdateStatus>
  reload?: () => void
  intervalMs?: number
  timeoutMs?: number
  setIntervalImpl?: typeof globalThis.setInterval
  clearIntervalImpl?: typeof globalThis.clearInterval
  setTimeoutImpl?: typeof globalThis.setTimeout
  clearTimeoutImpl?: typeof globalThis.clearTimeout
}

export const reloadPage = () => {
  globalThis.location.reload()
}

const coerceVersionPart = (value: string) => {
  if (/^\d+$/u.test(value)) {
    return Number.parseInt(value, 10)
  }

  return value
}

const parsePackageVersion = (version: string) => {
  const [withoutBuildMetadata = version] = version.split('+', 1)
  const prereleaseSeparator = withoutBuildMetadata.indexOf('-')
  const core = prereleaseSeparator >= 0
    ? withoutBuildMetadata.slice(0, prereleaseSeparator)
    : withoutBuildMetadata
  const prerelease = prereleaseSeparator >= 0
    ? withoutBuildMetadata.slice(prereleaseSeparator + 1).split('.')
    : null

  return {
    core: core.split('.').map(coerceVersionPart),
    prerelease
  }
}

export const comparePackageVersions = (left: string, right: string) => {
  const leftVersion = parsePackageVersion(left)
  const rightVersion = parsePackageVersion(right)
  const maxLength = Math.max(leftVersion.core.length, rightVersion.core.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftVersion.core[index] ?? 0
    const rightPart = rightVersion.core[index] ?? 0

    if (leftPart === rightPart) {
      continue
    }

    if (typeof leftPart === 'number' && typeof rightPart === 'number') {
      return leftPart > rightPart ? 1 : -1
    }

    return String(leftPart).localeCompare(String(rightPart), 'en')
  }

  if (leftVersion.prerelease === null || rightVersion.prerelease === null) {
    if (leftVersion.prerelease === rightVersion.prerelease) {
      return 0
    }
    return leftVersion.prerelease === null ? 1 : -1
  }

  const prereleaseLength = Math.max(
    leftVersion.prerelease.length,
    rightVersion.prerelease.length
  )
  for (let index = 0; index < prereleaseLength; index += 1) {
    const leftIdentifier = leftVersion.prerelease[index]
    const rightIdentifier = rightVersion.prerelease[index]

    if (leftIdentifier === undefined || rightIdentifier === undefined) {
      return leftIdentifier === undefined ? -1 : 1
    }
    if (leftIdentifier === rightIdentifier) {
      continue
    }

    const leftNumeric = /^\d+$/u.test(leftIdentifier)
    const rightNumeric = /^\d+$/u.test(rightIdentifier)
    if (leftNumeric && rightNumeric) {
      return Number.parseInt(leftIdentifier, 10) > Number.parseInt(rightIdentifier, 10) ? 1 : -1
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1
    }

    return leftIdentifier > rightIdentifier ? 1 : -1
  }

  return 0
}

export const createServiceUpdateCompletionMonitor = (
  options: ServiceUpdateCompletionMonitorOptions
) => {
  const reload = options.reload ?? reloadPage
  const intervalMs = options.intervalMs ?? SERVICE_UPDATE_COMPLETION_POLL_INTERVAL_MS
  const timeoutMs = options.timeoutMs ?? SERVICE_UPDATE_COMPLETION_TIMEOUT_MS
  const setIntervalImpl = options.setIntervalImpl ?? globalThis.setInterval.bind(globalThis)
  const clearIntervalImpl = options.clearIntervalImpl ?? globalThis.clearInterval.bind(globalThis)
  const setTimeoutImpl = options.setTimeoutImpl ?? globalThis.setTimeout.bind(globalThis)
  const clearTimeoutImpl = options.clearTimeoutImpl ?? globalThis.clearTimeout.bind(globalThis)

  let timer: ReturnType<typeof globalThis.setInterval> | null = null
  let timeoutTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let expectedVersion: string | null = null
  let polling = false
  let watchGeneration = 0

  const stop = () => {
    watchGeneration += 1
    expectedVersion = null
    if (timer !== null) {
      clearIntervalImpl(timer)
      timer = null
    }
    if (timeoutTimer !== null) {
      clearTimeoutImpl(timeoutTimer)
      timeoutTimer = null
    }
  }

  const poll = async (generation: number) => {
    if (polling || generation !== watchGeneration || expectedVersion === null) {
      return
    }

    polling = true
    try {
      const status = await options.refreshStatus()
      if (
        generation === watchGeneration
        && (status.phase === 'failed' || status.phase === 'rolled-back')
      ) {
        stop()
        return
      }
      if (
        generation === watchGeneration
        && status.enabled
        && !status.updating
        && status.installedVersion !== null
        && comparePackageVersions(status.installedVersion, expectedVersion) >= 0
      ) {
        stop()
        reload()
      }
    } catch {
      // The service is expected to be unreachable between shutdown and the new
      // listener binding. Keep polling until the target bundle answers.
    } finally {
      polling = false
    }
  }

  const start = (version: string | null) => {
    stop()
    if (!version) {
      return false
    }

    expectedVersion = version
    const generation = watchGeneration
    timer = setIntervalImpl(() => {
      void poll(generation)
    }, intervalMs)
    timeoutTimer = setTimeoutImpl(stop, timeoutMs)
    return true
  }

  return {
    start,
    stop
  }
}

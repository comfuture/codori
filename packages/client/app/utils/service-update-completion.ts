import type { ServiceUpdateStatus } from '~~/shared/codori'

export const SERVICE_UPDATE_COMPLETION_POLL_INTERVAL_MS = 1_000

type ServiceUpdateCompletionMonitorOptions = {
  refreshStatus: () => Promise<ServiceUpdateStatus>
  reload?: () => void
  intervalMs?: number
  setIntervalImpl?: typeof globalThis.setInterval
  clearIntervalImpl?: typeof globalThis.clearInterval
}

export const reloadPage = () => {
  globalThis.location.reload()
}

export const createServiceUpdateCompletionMonitor = (
  options: ServiceUpdateCompletionMonitorOptions
) => {
  const reload = options.reload ?? reloadPage
  const intervalMs = options.intervalMs ?? SERVICE_UPDATE_COMPLETION_POLL_INTERVAL_MS
  const setIntervalImpl = options.setIntervalImpl ?? globalThis.setInterval.bind(globalThis)
  const clearIntervalImpl = options.clearIntervalImpl ?? globalThis.clearInterval.bind(globalThis)

  let timer: ReturnType<typeof globalThis.setInterval> | null = null
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
        && status.enabled
        && !status.updating
        && status.installedVersion === expectedVersion
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
    return true
  }

  return {
    start,
    stop
  }
}

export const PROJECT_DISCOVERY_RETRY_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const

export type ProjectDiscoveryRetryState<T> =
  | { status: 'loading', attempt: number, maxAttempts: number }
  | { status: 'retrying', attempt: number, maxAttempts: number, delayMs: number, error: unknown }
  | { status: 'ready', attempt: number, maxAttempts: number, result: T }
  | { status: 'error', attempt: number, maxAttempts: number, error: unknown }

type ProjectDiscoveryRunnerOptions<T> = {
  discover: (signal: AbortSignal) => Promise<T>
  isRetryable: (error: unknown) => boolean
  onState: (state: ProjectDiscoveryRetryState<T>) => void
  retryDelaysMs?: readonly number[]
}

export const createProjectDiscoveryRunner = <T>(options: ProjectDiscoveryRunnerOptions<T>) => {
  const retryDelaysMs = options.retryDelaysMs ?? PROJECT_DISCOVERY_RETRY_DELAYS_MS
  const maxAttempts = retryDelaysMs.length + 1
  let activeRun: Promise<T | undefined> | null = null
  let abortController: AbortController | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let finishRetryWait: ((shouldContinue: boolean) => void) | null = null

  const waitForRetry = (delayMs: number) => new Promise<boolean>((resolve) => {
    finishRetryWait = resolve
    retryTimer = setTimeout(() => {
      retryTimer = null
      finishRetryWait = null
      resolve(true)
    }, delayMs)
  })

  const cancel = () => {
    abortController?.abort()
    abortController = null
    if (retryTimer !== null) {
      clearTimeout(retryTimer)
      retryTimer = null
    }
    finishRetryWait?.(false)
    finishRetryWait = null
  }

  const start = () => {
    if (activeRun) {
      return activeRun
    }

    abortController = new AbortController()
    const controller = abortController
    const run = (async () => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (controller.signal.aborted) {
          return undefined
        }
        options.onState({ status: 'loading', attempt, maxAttempts })
        try {
          const result = await options.discover(controller.signal)
          if (controller.signal.aborted) {
            return undefined
          }
          options.onState({ status: 'ready', attempt, maxAttempts, result })
          return result
        } catch (error) {
          if (controller.signal.aborted) {
            return undefined
          }
          const delayMs = retryDelaysMs[attempt - 1]
          if (delayMs === undefined || !options.isRetryable(error)) {
            options.onState({ status: 'error', attempt, maxAttempts, error })
            return undefined
          }
          options.onState({ status: 'retrying', attempt, maxAttempts, delayMs, error })
          if (!await waitForRetry(delayMs)) {
            return undefined
          }
        }
      }
      return undefined
    })()

    const wrappedRun = run.finally(() => {
      if (activeRun === wrappedRun) {
        activeRun = null
      }
      if (abortController === controller) {
        abortController = null
      }
    })
    activeRun = wrappedRun
    return wrappedRun
  }

  return {
    start,
    cancel
  }
}

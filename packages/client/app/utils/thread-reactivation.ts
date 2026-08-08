import type { ThreadReadParams } from '~~/shared/generated/codex-app-server/v2/ThreadReadParams'
import type { ThreadReadResponse } from '~~/shared/generated/codex-app-server/v2/ThreadReadResponse'
import type { ThreadResumeParams } from '~~/shared/generated/codex-app-server/v2/ThreadResumeParams'
import type { ThreadResumeResponse } from '~~/shared/generated/codex-app-server/v2/ThreadResumeResponse'
import type { Thread } from '~~/shared/generated/codex-app-server/v2/Thread'
import type { Turn } from '~~/shared/generated/codex-app-server/v2/Turn'

export type ThreadReactivationReason =
  | 'window/visible'
  | 'window/focus'
  | 'window/interaction'
  | 'window/online'
  | 'window/pageshow'
  | 'document/resume'

type ThreadReactivationTimer = ReturnType<typeof globalThis.setTimeout> | number

type ThreadReactivationRecoveryCoordinatorOptions = {
  now?: () => number
  setTimeout?: (handler: () => void, delayMs: number) => ThreadReactivationTimer
  clearTimeout?: (timer: ThreadReactivationTimer) => void
  recover: (reason: ThreadReactivationReason) => Promise<void>
}

type BrowserRuntime = {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  userAgentData?: {
    mobile?: boolean
    platform?: string
  }
}

type ThreadReactivationResumeClient = {
  connect(): Promise<void>
  reconnect(): Promise<void>
  request<T>(method: 'thread/resume', params: ThreadResumeParams): Promise<T>
  request<T>(method: 'thread/read', params: ThreadReadParams): Promise<T>
}

type ThreadViewHydrationClient = {
  request<T>(method: 'thread/resume', params: ThreadResumeParams): Promise<T>
  request<T>(method: 'thread/read', params: ThreadReadParams): Promise<T>
}

export type ThreadReactivationResumeResult = {
  resumeResponse: ThreadResumeResponse
  readResponse: ThreadReadResponse
}

export const recoverThreadAfterReactivation = async (
  client: ThreadReactivationResumeClient,
  resumeParams: ThreadResumeParams,
  options: { reconcileThread: boolean }
): Promise<ThreadReactivationResumeResult | null> => {
  if (!options.reconcileThread) {
    await client.connect()
    return null
  }

  return await resumeThreadStreamAfterReactivation(client, resumeParams)
}

export type ThreadViewHydrationResult = {
  resumeResponse: ThreadResumeResponse | null
  readResponse: ThreadReadResponse
}

type ThreadWithTurns = Pick<Thread, 'turns'>
type ThreadActivationSnapshot = Pick<Thread, 'status' | 'turns'>

const desktopRecoveryReasons = new Set<ThreadReactivationReason>([
  'window/online',
  'window/pageshow',
  'document/resume'
])

const desktopDeactivationRecoveryReasons = new Set<ThreadReactivationReason>([
  'window/visible',
  'window/focus'
])

const resolveBrowserRuntime = (): BrowserRuntime | null => {
  if (typeof navigator === 'undefined') {
    return null
  }

  const runtime = navigator as BrowserRuntime
  return {
    userAgent: runtime.userAgent,
    platform: runtime.platform,
    maxTouchPoints: runtime.maxTouchPoints,
    userAgentData: runtime.userAgentData
  }
}

export const isConstrainedBrowserRequiringDeferredSync = (
  runtime: BrowserRuntime | null = resolveBrowserRuntime()
) => {
  if (!runtime) {
    return false
  }

  const userAgent = runtime.userAgent?.toLowerCase() ?? ''
  const platform = runtime.platform?.toLowerCase() ?? ''
  const uaDataPlatform = runtime.userAgentData?.platform?.toLowerCase() ?? ''
  const maxTouchPoints = runtime.maxTouchPoints ?? 0

  const hasMobileUserAgent = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini|windows phone/.test(userAgent)
  const isMobileClientHint = runtime.userAgentData?.mobile === true
  const isAndroidClientHint = uaDataPlatform === 'android'
  const isIPadOSDesktopMode = platform === 'macintel' && maxTouchPoints > 1

  return hasMobileUserAgent
    || isMobileClientHint
    || isAndroidClientHint
    || isIPadOSDesktopMode
}

export const shouldAttemptThreadReactivationSync = (input: {
  reason: ThreadReactivationReason
  browserRequiresDeferredSync: boolean
  transportConnected: boolean
  hadDocumentDeactivation: boolean
}) => {
  if (!input.transportConnected) {
    return true
  }

  if (desktopRecoveryReasons.has(input.reason)) {
    return true
  }

  if (input.hadDocumentDeactivation && desktopDeactivationRecoveryReasons.has(input.reason)) {
    return true
  }

  return input.browserRequiresDeferredSync && input.hadDocumentDeactivation
}

export const resolveThreadReactivationDelay = (input: {
  now: number
  lastRecoveryAt: number
  deactivatedAt: number | null
  minimumIntervalMs: number
  inactiveGraceMs: number
}) => {
  const minimumIntervalRemaining = input.lastRecoveryAt > 0
    ? input.minimumIntervalMs - (input.now - input.lastRecoveryAt)
    : 0
  const inactiveGraceRemaining = input.deactivatedAt === null
    ? 0
    : input.inactiveGraceMs - (input.now - input.deactivatedAt)

  return Math.max(0, minimumIntervalRemaining, inactiveGraceRemaining)
}

export const createThreadReactivationRecoveryCoordinator = (
  options: ThreadReactivationRecoveryCoordinatorOptions
) => {
  const now = options.now ?? Date.now
  const setTimer = options.setTimeout ?? globalThis.setTimeout
  const clearTimer = options.clearTimeout ?? globalThis.clearTimeout
  let pendingRecovery: Promise<void> | null = null
  let scheduledTimer: ThreadReactivationTimer | null = null
  let scheduledAt = 0
  let scheduledReason: ThreadReactivationReason | null = null
  let disposed = false

  const clearScheduledRecovery = () => {
    if (scheduledTimer !== null) {
      clearTimer(scheduledTimer)
    }
    scheduledTimer = null
    scheduledAt = 0
    scheduledReason = null
  }

  const request = (
    reason: ThreadReactivationReason,
    delayMs = 0
  ): Promise<void> | null => {
    if (disposed) {
      return null
    }
    if (pendingRecovery) {
      return pendingRecovery
    }

    if (delayMs > 0) {
      const nextScheduledAt = now() + delayMs
      scheduledReason = reason
      if (scheduledTimer !== null && scheduledAt <= nextScheduledAt) {
        return null
      }

      clearScheduledRecovery()
      scheduledReason = reason
      scheduledAt = nextScheduledAt
      scheduledTimer = setTimer(() => {
        const nextReason = scheduledReason
        scheduledTimer = null
        scheduledAt = 0
        scheduledReason = null
        if (!nextReason || disposed) {
          return
        }
        void request(nextReason)?.catch(() => {})
      }, delayMs)
      return null
    }

    clearScheduledRecovery()
    const recovery = Promise.resolve().then(() => options.recover(reason))
    pendingRecovery = recovery
    void recovery.finally(() => {
      if (pendingRecovery === recovery) {
        pendingRecovery = null
      }
    }).catch(() => {})
    return recovery
  }

  const dispose = () => {
    disposed = true
    clearScheduledRecovery()
  }

  return {
    request,
    dispose
  }
}

export const isActiveTurnStatus = (value: string | null | undefined) => {
  return value === 'inProgress'
}

export const findActiveTurn = (thread: ThreadWithTurns): Turn | null =>
  thread.turns.findLast(turn => isActiveTurnStatus(turn.status)) ?? null

const findTurnById = (thread: ThreadWithTurns, turnId: string) =>
  thread.turns.findLast(turn => turn.id === turnId) ?? null

export const resolveHydratedActiveTurn = (input: {
  readThread: ThreadActivationSnapshot
  resumeThread?: ThreadWithTurns | null
}) => {
  if (input.readThread.status.type !== 'active') {
    return null
  }

  const readActiveTurn = findActiveTurn(input.readThread)
  if (readActiveTurn) {
    return readActiveTurn
  }

  const resumeActiveTurn = input.resumeThread ? findActiveTurn(input.resumeThread) : null
  if (!resumeActiveTurn) {
    return null
  }

  const matchingReadTurn = findTurnById(input.readThread, resumeActiveTurn.id)
  if (matchingReadTurn && !isActiveTurnStatus(matchingReadTurn.status)) {
    return null
  }

  return resumeActiveTurn
}

export const hydrateThreadView = async (
  client: ThreadViewHydrationClient,
  resumeParams: ThreadResumeParams,
  options: {
    resume: boolean
  }
): Promise<ThreadViewHydrationResult> => {
  const resumeResponse = options.resume
    ? await client.request<ThreadResumeResponse>('thread/resume', resumeParams)
    : null
  const readResponse = await client.request<ThreadReadResponse>('thread/read', {
    threadId: resumeParams.threadId,
    includeTurns: true
  })

  return {
    resumeResponse,
    readResponse
  }
}

export const resumeThreadStreamAfterReactivation = async (
  client: ThreadReactivationResumeClient,
  resumeParams: ThreadResumeParams
): Promise<ThreadReactivationResumeResult> => {
  await client.reconnect()

  const resumeResponse = await client.request<ThreadResumeResponse>('thread/resume', resumeParams)
  const readResponse = await client.request<ThreadReadResponse>('thread/read', {
    threadId: resumeParams.threadId,
    includeTurns: true
  })

  return {
    resumeResponse,
    readResponse
  }
}

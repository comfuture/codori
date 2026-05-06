import type { ThreadReadParams } from '~~/shared/generated/codex-app-server/v2/ThreadReadParams'
import type { ThreadReadResponse } from '~~/shared/generated/codex-app-server/v2/ThreadReadResponse'
import type { ThreadResumeParams } from '~~/shared/generated/codex-app-server/v2/ThreadResumeParams'
import type { ThreadResumeResponse } from '~~/shared/generated/codex-app-server/v2/ThreadResumeResponse'

export type ThreadReactivationReason =
  | 'window/visible'
  | 'window/focus'
  | 'window/interaction'
  | 'window/online'
  | 'window/pageshow'
  | 'document/resume'

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
  reconnect(): Promise<void>
  request<T>(method: 'thread/resume', params: ThreadResumeParams): Promise<T>
  request<T>(method: 'thread/read', params: ThreadReadParams): Promise<T>
}

export type ThreadReactivationResumeResult = {
  resumeResponse: ThreadResumeResponse
  readResponse: ThreadReadResponse
}

const desktopRecoveryReasons = new Set<ThreadReactivationReason>([
  'window/online',
  'window/pageshow',
  'document/resume'
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

  return input.browserRequiresDeferredSync && input.hadDocumentDeactivation
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

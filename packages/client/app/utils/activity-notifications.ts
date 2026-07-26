import type { CodexRpcNotification } from '~~/shared/codex-rpc'

export type ActivityNotificationCandidate = {
  threadId: string
  turnId: string
  itemId: string
  text: string
}

export type ActivityNotificationSurface = 'none' | 'toast' | 'system'

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

export const extractActivityNotificationCandidate = (
  notification: CodexRpcNotification
): ActivityNotificationCandidate | null => {
  if (notification.method !== 'item/completed') {
    return null
  }
  const params = asRecord(notification.params)
  const item = asRecord(params?.item)
  if (
    !params
    || item?.type !== 'agentMessage'
    || item.phase === 'commentary'
    || typeof params.threadId !== 'string'
    || typeof params.turnId !== 'string'
    || typeof item.id !== 'string'
    || typeof item.text !== 'string'
    || !item.text.trim()
  ) {
    return null
  }
  return {
    threadId: params.threadId,
    turnId: params.turnId,
    itemId: item.id,
    text: item.text.trim()
  }
}

export const selectActivityNotificationSurface = (input: {
  documentVisible: boolean
  windowFocused: boolean
  viewingThread: boolean
  systemNotificationsEnabled: boolean
}) : ActivityNotificationSurface => {
  const tabActive = input.documentVisible && input.windowFocused
  if (tabActive && input.viewingThread) {
    return 'none'
  }
  if (!tabActive) {
    return input.systemNotificationsEnabled ? 'system' : 'none'
  }
  return 'toast'
}

export const compactNotificationText = (text: string, maximum = 180) => {
  const compact = text.replace(/\s+/g, ' ').trim()
  return compact.length > maximum
    ? `${compact.slice(0, maximum - 1).trimEnd()}…`
    : compact
}

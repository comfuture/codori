import { normalizeThreadTitleCandidate } from '../composables/useThreadSummaries'
import {
  notificationThreadId,
  notificationThreadName,
  notificationThreadUpdatedAt,
  type CodexRpcNotification
} from '~~/shared/codex-rpc'

export type ActiveThreadTitleNotificationTarget = {
  activeThreadId: string | null
  setThreadTitle: (title: string) => void
  syncSessionTitle: (title: string) => void
  updateThreadSummaryTitle: (threadId: string, title: string, updatedAt?: number) => void
}

export const applyActiveThreadTitleNotification = (
  notification: CodexRpcNotification,
  target: ActiveThreadTitleNotificationTarget
) => {
  if (notification.method !== 'thread/name/updated') {
    return false
  }

  const threadId = notificationThreadId(notification)
  if (!threadId || threadId !== target.activeThreadId) {
    return false
  }

  const title = normalizeThreadTitleCandidate(notificationThreadName(notification))
  if (!title) {
    return false
  }

  target.setThreadTitle(title)
  target.syncSessionTitle(title)
  target.updateThreadSummaryTitle(
    threadId,
    title,
    notificationThreadUpdatedAt(notification)
  )
  return true
}

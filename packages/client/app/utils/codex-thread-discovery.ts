import type { CodexRpcNotification } from '~~/shared/codex-rpc'
import type { Thread } from '~~/shared/generated/codex-app-server/v2/Thread'
import type { ThreadStatus } from '~~/shared/generated/codex-app-server/v2/ThreadStatus'

export type ThreadDiscoveryStatusUpdate = {
  threadId: string
  status: ThreadStatus | null
}

export type ThreadDiscoveryThread = Pick<Thread, 'id'> & Partial<Omit<Thread, 'id'>>

export type ThreadDiscoveryHints = {
  thread: ThreadDiscoveryThread | null
  statusUpdate: ThreadDiscoveryStatusUpdate | null
  referencedThreadIds: string[]
}

export type ThreadRunningState = {
  threadId: string
  turnId: string | null
  running: boolean
  source: 'threadStatus' | 'turnLifecycle'
}

const referencedCollabTools = new Set([
  'spawnAgent',
  'sendInput',
  'resumeAgent',
  'sendMessage',
  'followupTask',
  'interruptAgent'
])

const subagentActivityKinds = new Set([
  'started',
  'interacted',
  'interrupted',
  'completed'
])

const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/u

const normalizeComparableWorkspacePath = (value: string) => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return WINDOWS_ABSOLUTE_PATH_RE.test(normalized)
    ? normalized.toLowerCase()
    : normalized
}

export const areThreadWorkspacePathsEqual = (left: string, right: string) =>
  normalizeComparableWorkspacePath(left) === normalizeComparableWorkspacePath(right)

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asNonEmptyString = (value: unknown) =>
  typeof value === 'string' && value.trim().length > 0 ? value : null

const notificationTurnId = (notification: CodexRpcNotification) => {
  if (!isObjectRecord(notification.params)) {
    return null
  }

  const directTurnId = asNonEmptyString(notification.params.turnId)
  if (directTurnId) {
    return directTurnId
  }

  const turn = notification.params.turn
  return isObjectRecord(turn) ? asNonEmptyString(turn.id) : null
}

const asThreadStatus = (value: unknown): ThreadStatus | null => {
  if (!isObjectRecord(value)) {
    return null
  }

  switch (value.type) {
    case 'notLoaded':
    case 'idle':
    case 'systemError':
      return { type: value.type }
    case 'active': {
      const activeFlags = Array.isArray(value.activeFlags)
        ? value.activeFlags.filter((flag): flag is 'waitingOnApproval' | 'waitingOnUserInput' =>
            flag === 'waitingOnApproval' || flag === 'waitingOnUserInput')
        : []
      return { type: 'active', activeFlags }
    }
    default:
      return null
  }
}

const asStartedThread = (notification: CodexRpcNotification): ThreadDiscoveryThread | null => {
  if (notification.method !== 'thread/started' || !isObjectRecord(notification.params)) {
    return null
  }

  const thread = notification.params.thread
  if (!isObjectRecord(thread) || !asNonEmptyString(thread.id)) {
    return null
  }

  // Generated notification types describe the expected complete object. Runtime
  // validation deliberately requires only its stable identity so older app-server
  // versions that omit newly added Thread fields can still be discovered and hydrated.
  return thread as ThreadDiscoveryThread
}

const asStatusUpdate = (
  notification: CodexRpcNotification
): ThreadDiscoveryStatusUpdate | null => {
  if (notification.method !== 'thread/status/changed' || !isObjectRecord(notification.params)) {
    return null
  }

  const threadId = asNonEmptyString(notification.params.threadId)
  const status = asThreadStatus(notification.params.status)
  return threadId ? { threadId, status } : null
}

const referencedThreadIds = (notification: CodexRpcNotification) => {
  if (
    notification.method !== 'item/started'
    && notification.method !== 'item/completed'
  ) {
    return []
  }

  if (!isObjectRecord(notification.params) || !isObjectRecord(notification.params.item)) {
    return []
  }

  const item = notification.params.item
  if (
    item.type === 'subAgentActivity'
    && subagentActivityKinds.has(String(item.kind))
  ) {
    const threadId = asNonEmptyString(item.agentThreadId)
    return threadId ? [threadId] : []
  }

  if (
    item.type !== 'collabAgentToolCall'
    || !referencedCollabTools.has(String(item.tool))
  ) {
    return []
  }

  const receiverThreadIds = Array.isArray(item.receiverThreadIds)
    ? item.receiverThreadIds
    : []
  const agentStateThreadIds = isObjectRecord(item.agentsStates)
    ? Object.keys(item.agentsStates)
    : []

  return [...new Set([...receiverThreadIds, ...agentStateThreadIds]
    .map(asNonEmptyString)
    .filter((threadId): threadId is string => threadId !== null))]
}

export const extractThreadDiscoveryHints = (
  notification: CodexRpcNotification
): ThreadDiscoveryHints => ({
  thread: asStartedThread(notification),
  statusUpdate: asStatusUpdate(notification),
  referencedThreadIds: referencedThreadIds(notification)
})

export const normalizeThreadRunningState = (
  notification: CodexRpcNotification
): ThreadRunningState | null => {
  const statusUpdate = asStatusUpdate(notification)
  if (statusUpdate?.status) {
    return {
      threadId: statusUpdate.threadId,
      turnId: null,
      running: statusUpdate.status.type === 'active',
      source: 'threadStatus'
    }
  }

  const startedThread = asStartedThread(notification)
  const startedStatus = startedThread ? asThreadStatus(startedThread.status) : null
  if (startedThread && startedStatus) {
    return {
      threadId: startedThread.id,
      turnId: null,
      running: startedStatus.type === 'active',
      source: 'threadStatus'
    }
  }

  if (
    (notification.method === 'turn/started'
      || notification.method === 'turn/completed'
      || notification.method === 'turn/failed')
    && isObjectRecord(notification.params)
  ) {
    const threadId = asNonEmptyString(notification.params.threadId)
    if (threadId) {
      return {
        threadId,
        turnId: notificationTurnId(notification),
        running: notification.method === 'turn/started',
        source: 'turnLifecycle'
      }
    }
  }

  // Collaboration activity can refer to a running, queued, completed, or
  // interrupted target. In particular, `send_message` and `followup_task` both
  // emit `interacted`, so these items must never infer target running state.
  return null
}

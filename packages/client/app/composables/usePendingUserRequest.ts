import { computed, ref, watch, type Ref } from 'vue'
import type { CodexRpcServerRequest } from '../../shared/codex-rpc'
import {
  buildPendingUserRequestDismissResponse,
  parsePendingUserRequest,
  type PendingUserRequest,
  type PendingUserRequestState
} from '../../shared/pending-user-request'

type PendingUserRequestId = PendingUserRequest['requestId']

type PendingUserRequestQueueEntry = {
  request: PendingUserRequest
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  submitting: boolean
}

type PendingUserRequestSession = {
  current: Ref<PendingUserRequestState | null>
  queue: PendingUserRequestQueueEntry[]
}

const sessions = new Map<string, PendingUserRequestSession>()
const entriesByRequestId = new Map<PendingUserRequestId, PendingUserRequestQueueEntry>()

const sessionKey = (projectId: string, threadId: string | null) =>
  `${projectId}::${threadId ?? '__draft__'}`

const projectSessions = (projectId: string) => {
  const prefix = `${projectId}::`

  return [...sessions.entries()]
    .filter(([key]) => key.startsWith(prefix))
    .map(([, session]) => session)
}

const getSession = (projectId: string, threadId: string | null): PendingUserRequestSession => {
  const key = sessionKey(projectId, threadId)
  const existing = sessions.get(key)
  if (existing) {
    return existing
  }

  const session: PendingUserRequestSession = {
    current: ref<PendingUserRequestState | null>(null),
    queue: []
  }
  sessions.set(key, session)
  return session
}

const promoteNextRequest = (session: PendingUserRequestSession) => {
  const entry = session.queue[0]
  session.current.value = entry
    ? {
        ...entry.request,
        submitting: entry.submitting
      }
    : null
}

const movePendingRequests = (
  sourceSession: PendingUserRequestSession,
  targetSession: PendingUserRequestSession
) => {
  if (sourceSession === targetSession || sourceSession.queue.length === 0) {
    return
  }

  const targetWasEmpty = targetSession.queue.length === 0
  targetSession.queue.push(...sourceSession.queue)
  sourceSession.queue.splice(0, sourceSession.queue.length)
  sourceSession.current.value = null

  if (targetWasEmpty) {
    promoteNextRequest(targetSession)
  }
}

const resolveQueuedRequest = (session: PendingUserRequestSession, responseFactory: (request: PendingUserRequest) => unknown) => {
  while (session.queue.length > 0) {
    const entry = session.queue.shift()
    if (!entry) {
      continue
    }

    entriesByRequestId.delete(entry.request.requestId)
    entry.resolve(responseFactory(entry.request))
  }

  session.current.value = null
}

const resolveSessionEntry = (
  session: PendingUserRequestSession,
  requestId: PendingUserRequestId,
  settle: (entry: PendingUserRequestQueueEntry) => void
) => {
  const entryIndex = session.queue.findIndex(entry => entry.request.requestId === requestId)
  if (entryIndex < 0) {
    return
  }

  const [entry] = session.queue.splice(entryIndex, 1)
  if (!entry) {
    return
  }

  entriesByRequestId.delete(entry.request.requestId)
  settle(entry)

  if (entryIndex === 0) {
    promoteNextRequest(session)
  }
}

export const usePendingUserRequest = (
  projectId: string,
  currentThreadId: Ref<string | null>,
  activeThreadId: Ref<string | null> = currentThreadId
) => {
  const resolveSession = (threadId: string | null) => getSession(projectId, threadId)

  watch(activeThreadId, (nextThreadId, previousThreadId) => {
    if (!nextThreadId || previousThreadId !== null) {
      return
    }

    const draftSession = sessions.get(sessionKey(projectId, null))
    if (!draftSession || draftSession.queue.length === 0) {
      return
    }

    const activeSession = resolveSession(nextThreadId)
    movePendingRequests(draftSession, activeSession)
    sessions.delete(sessionKey(projectId, null))
  })

  const handleServerRequest = async (request: CodexRpcServerRequest) => {
    const normalized = parsePendingUserRequest(request)
    if (!normalized) {
      return null
    }

    const session = resolveSession(normalized.threadId ?? currentThreadId.value)

    return await new Promise((resolve, reject) => {
      const entry: PendingUserRequestQueueEntry = {
        request: normalized,
        resolve,
        reject,
        submitting: false
      }
      session.queue.push(entry)
      entriesByRequestId.set(normalized.requestId, entry)

      if (!session.current.value) {
        promoteNextRequest(session)
      }
    })
  }

  const resolveRequest = (requestId: PendingUserRequestId, response: unknown) => {
    const entry = entriesByRequestId.get(requestId)
    if (!entry || entry.submitting) {
      return false
    }

    entry.submitting = true
    entry.resolve(response)

    for (const session of projectSessions(projectId)) {
      if (session.queue[0]?.request.requestId === requestId) {
        promoteNextRequest(session)
        break
      }
    }

    return true
  }

  const rejectRequest = (requestId: PendingUserRequestId, error: unknown) => {
    const entry = entriesByRequestId.get(requestId)
    if (!entry) {
      return false
    }

    const session = projectSessions(projectId).find(candidate =>
      candidate.queue.some(queueEntry => queueEntry.request.requestId === requestId)
    ) ?? resolveSession(currentThreadId.value)
    resolveSessionEntry(session, requestId, entry => {
      entry.reject(error)
    })
    return true
  }

  const markRequestResolved = (requestId: PendingUserRequestId, threadId?: string | null) => {
    const entry = entriesByRequestId.get(requestId)
    if (!entry) {
      return false
    }

    const session = (threadId !== undefined
      ? projectSessions(projectId).find(candidate => candidate.current.value?.threadId === threadId)
      : null)
      ?? projectSessions(projectId).find(candidate =>
      candidate.queue.some(queueEntry => queueEntry.request.requestId === requestId)
      )
    if (!session) {
      entriesByRequestId.delete(requestId)
      return false
    }

    resolveSessionEntry(session, requestId, () => {})
    return true
  }

  const cancelAllPendingRequests = () => {
    const projectSessionPrefix = `${projectId}::`

    for (const [key, session] of sessions.entries()) {
      if (!key.startsWith(projectSessionPrefix)) {
        continue
      }

      resolveQueuedRequest(session, buildPendingUserRequestDismissResponse)
      sessions.delete(key)
    }
  }

  return {
    pendingRequest: computed(() => resolveSession(currentThreadId.value).current.value),
    hasPendingRequest: computed(() => resolveSession(currentThreadId.value).current.value !== null),
    handleServerRequest,
    resolveRequest,
    rejectRequest,
    markRequestResolved,
    cancelAllPendingRequests
  }
}

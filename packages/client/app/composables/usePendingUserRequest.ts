import { computed, ref, watch, type Ref } from 'vue'
import type { CodexRpcServerRequest } from '../../shared/codex-rpc'
import {
  buildPendingUserRequestDismissResponse,
  parsePendingUserRequest,
  type PendingUserRequest
} from '../../shared/pending-user-request'

type PendingUserRequestQueueEntry = {
  request: PendingUserRequest
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

type PendingUserRequestSession = {
  current: Ref<PendingUserRequest | null>
  queue: PendingUserRequestQueueEntry[]
}

const sessions = new Map<string, PendingUserRequestSession>()

const sessionKey = (projectId: string, threadId: string | null) =>
  `${projectId}::${threadId ?? '__draft__'}`

const getSession = (projectId: string, threadId: string | null): PendingUserRequestSession => {
  const key = sessionKey(projectId, threadId)
  const existing = sessions.get(key)
  if (existing) {
    return existing
  }

  const session: PendingUserRequestSession = {
    current: ref<PendingUserRequest | null>(null),
    queue: []
  }
  sessions.set(key, session)
  return session
}

const promoteNextRequest = (session: PendingUserRequestSession) => {
  session.current.value = session.queue[0]?.request ?? null
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

    entry.resolve(responseFactory(entry.request))
  }

  session.current.value = null
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
      session.queue.push({
        request: normalized,
        resolve,
        reject
      })

      if (!session.current.value) {
        promoteNextRequest(session)
      }
    })
  }

  const resolveCurrentRequest = (response: unknown) => {
    const session = resolveSession(currentThreadId.value)
    const current = session.queue.shift()
    if (!current) {
      return
    }

    current.resolve(response)
    promoteNextRequest(session)
  }

  const rejectCurrentRequest = (error: unknown) => {
    const session = resolveSession(currentThreadId.value)
    const current = session.queue.shift()
    if (!current) {
      return
    }

    current.reject(error)
    promoteNextRequest(session)
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
    resolveCurrentRequest,
    rejectCurrentRequest,
    cancelAllPendingRequests
  }
}

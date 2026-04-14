import { computed, ref, type Ref } from 'vue'
import type { CodexRpcServerRequest } from '../../shared/codex-rpc'
import { parsePendingUserRequest, type PendingUserRequest } from '../../shared/pending-user-request'

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

export const usePendingUserRequest = (projectId: string, activeThreadId: Ref<string | null>) => {
  const resolveSession = (threadId: string | null) => getSession(projectId, threadId)

  const handleServerRequest = async (request: CodexRpcServerRequest) => {
    const normalized = parsePendingUserRequest(request)
    if (!normalized) {
      return null
    }

    const session = resolveSession(normalized.threadId ?? activeThreadId.value)

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
    const session = resolveSession(activeThreadId.value)
    const current = session.queue.shift()
    if (!current) {
      return
    }

    current.resolve(response)
    promoteNextRequest(session)
  }

  const rejectCurrentRequest = (error: unknown) => {
    const session = resolveSession(activeThreadId.value)
    const current = session.queue.shift()
    if (!current) {
      return
    }

    current.reject(error)
    promoteNextRequest(session)
  }

  return {
    pendingRequest: computed(() => resolveSession(activeThreadId.value).current.value),
    hasPendingRequest: computed(() => resolveSession(activeThreadId.value).current.value !== null),
    handleServerRequest,
    resolveCurrentRequest,
    rejectCurrentRequest
  }
}

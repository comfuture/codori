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

const getSession = (projectId: string): PendingUserRequestSession => {
  const existing = sessions.get(projectId)
  if (existing) {
    return existing
  }

  const session: PendingUserRequestSession = {
    current: ref<PendingUserRequest | null>(null),
    queue: []
  }
  sessions.set(projectId, session)
  return session
}

const promoteNextRequest = (session: PendingUserRequestSession) => {
  session.current.value = session.queue[0]?.request ?? null
}

export const usePendingUserRequest = (projectId: string) => {
  const session = getSession(projectId)

  const handleServerRequest = async (request: CodexRpcServerRequest) => {
    const normalized = parsePendingUserRequest(request)
    if (!normalized) {
      return null
    }

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
    const current = session.queue.shift()
    if (!current) {
      return
    }

    current.resolve(response)
    promoteNextRequest(session)
  }

  const rejectCurrentRequest = (error: unknown) => {
    const current = session.queue.shift()
    if (!current) {
      return
    }

    current.reject(error)
    promoteNextRequest(session)
  }

  return {
    pendingRequest: session.current,
    hasPendingRequest: computed(() => session.current.value !== null),
    handleServerRequest,
    resolveCurrentRequest,
    rejectCurrentRequest
  }
}

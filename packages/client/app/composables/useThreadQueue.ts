import { ref, watch, type Ref } from 'vue'
import type { CodexRpcConnectionState, CodexRpcNotification } from '~~/shared/codex-rpc'
import type { QueuedSubmission } from '~~/shared/generated/codex-app-server/v2/QueuedSubmission'
import type { ThreadQueueAddParams } from '~~/shared/generated/codex-app-server/v2/ThreadQueueAddParams'
import type { ThreadQueueAddResponse } from '~~/shared/generated/codex-app-server/v2/ThreadQueueAddResponse'
import type { ThreadQueueDeleteParams } from '~~/shared/generated/codex-app-server/v2/ThreadQueueDeleteParams'
import type { ThreadQueueDeleteResponse } from '~~/shared/generated/codex-app-server/v2/ThreadQueueDeleteResponse'
import type { ThreadQueueListParams } from '~~/shared/generated/codex-app-server/v2/ThreadQueueListParams'
import type { ThreadQueueListResponse } from '~~/shared/generated/codex-app-server/v2/ThreadQueueListResponse'
import type { ThreadQueueReorderParams } from '~~/shared/generated/codex-app-server/v2/ThreadQueueReorderParams'
import type { ThreadQueueReorderResponse } from '~~/shared/generated/codex-app-server/v2/ThreadQueueReorderResponse'
import type { ThreadQueueStartParams } from '~~/shared/generated/codex-app-server/v2/ThreadQueueStartParams'
import type { ThreadQueueStartResponse } from '~~/shared/generated/codex-app-server/v2/ThreadQueueStartResponse'
import type { ThreadQueueUpdateParams } from '~~/shared/generated/codex-app-server/v2/ThreadQueueUpdateParams'
import type { ThreadQueueUpdateResponse } from '~~/shared/generated/codex-app-server/v2/ThreadQueueUpdateResponse'
import {
  THREAD_QUEUE_PAGE_SIZE,
  buildTextThreadQueueInput,
  formatThreadQueueError,
  isUnsupportedThreadQueueError
} from '~~/shared/thread-queue'

type ThreadQueueRpcClient = {
  request: <T>(method: string, params?: unknown) => Promise<T>
}

type UseThreadQueueOptions = {
  threadId: Ref<string | null>
  getClient: () => ThreadQueueRpcClient
  getLastTurnStatus?: (threadId: string) => string | null | undefined
}

export const useThreadQueue = (options: UseThreadQueueOptions) => {
  const submissions = ref<QueuedSubmission[]>([])
  const supported = ref<boolean | null>(null)
  const loading = ref(false)
  const mutating = ref(false)
  const error = ref<string | null>(null)
  const paused = ref(false)

  let selectedThreadId: string | null = null
  let contextGeneration = 0
  let refreshPromise: Promise<void> | null = null
  let refreshRequested = false
  let disconnected = false
  let automaticDispatchPaused = false
  let mutationSequence = 0

  const readAllPages = async (threadId: string) => {
    const client = options.getClient()
    const result: QueuedSubmission[] = []
    const seenIds = new Set<string>()
    const seenCursors = new Set<string>()
    let cursor: string | null = null

    do {
      const response: ThreadQueueListResponse = await client.request<ThreadQueueListResponse>('thread/queue/list', {
        threadId,
        cursor,
        limit: THREAD_QUEUE_PAGE_SIZE
      } satisfies ThreadQueueListParams)

      for (const submission of response.data) {
        if (!seenIds.has(submission.id)) {
          seenIds.add(submission.id)
          result.push(submission)
        }
      }

      cursor = response.nextCursor
      if (cursor) {
        if (seenCursors.has(cursor)) {
          throw new Error('The app-server returned a repeated queue pagination cursor.')
        }
        seenCursors.add(cursor)
      }
    } while (cursor)

    return result
  }

  const refresh = async (afterCurrent = false) => {
    const threadId = selectedThreadId
    if (!threadId) {
      return
    }
    if (refreshPromise) {
      if (afterCurrent) {
        refreshRequested = true
      }
      return await refreshPromise
    }

    const generation = contextGeneration
    const pendingRefresh = (async () => {
      loading.value = true
      do {
        refreshRequested = false
        try {
          const nextSubmissions = await readAllPages(threadId)
          if (generation !== contextGeneration || selectedThreadId !== threadId) {
            return
          }
          submissions.value = nextSubmissions
          supported.value = true
          error.value = null
          paused.value = automaticDispatchPaused && nextSubmissions.length > 0
        } catch (caughtError) {
          if (generation !== contextGeneration || selectedThreadId !== threadId) {
            return
          }
          const message = caughtError instanceof Error ? caughtError.message : String(caughtError)
          if (isUnsupportedThreadQueueError(message)) {
            supported.value = false
            submissions.value = []
            automaticDispatchPaused = false
            paused.value = false
            error.value = null
          } else {
            supported.value = true
            error.value = formatThreadQueueError('Queue refresh', caughtError)
          }
          return
        }
      } while (refreshRequested && generation === contextGeneration)
    })()

    refreshPromise = pendingRefresh
    try {
      await pendingRefresh
    } finally {
      if (refreshPromise === pendingRefresh) {
        refreshPromise = null
      }
      if (generation === contextGeneration) {
        loading.value = false
      }
    }
  }

  const requireMutationReady = () => {
    if (!selectedThreadId) {
      throw new Error('Open a thread before changing its prompt queue.')
    }
    if (supported.value === false) {
      throw new Error('This app-server version does not support durable prompt queues.')
    }
    if (mutating.value) {
      throw new Error('Another queue change is still in progress.')
    }
    return selectedThreadId
  }

  const beginMutation = () => ({
    threadId: requireMutationReady(),
    contextGeneration,
    token: ++mutationSequence
  })

  const isCurrentMutation = (mutation: ReturnType<typeof beginMutation>) =>
    mutation.contextGeneration === contextGeneration
    && mutation.threadId === selectedThreadId
    && mutation.token === mutationSequence

  const reconcileAfterMutationFailure = async (
    action: string,
    caughtError: unknown,
    fallback: QueuedSubmission[],
    mutation: ReturnType<typeof beginMutation>
  ) => {
    if (!isCurrentMutation(mutation)) {
      return
    }
    submissions.value = fallback
    await refresh(true)
    if (isCurrentMutation(mutation)) {
      error.value = formatThreadQueueError(action, caughtError)
    }
  }

  const add = async (text: string, clientUserMessageId: string) => {
    const mutation = beginMutation()
    const previous = submissions.value.slice()
    const optimisticId = `optimistic:${clientUserMessageId}`
    const input = buildTextThreadQueueInput(text)
    submissions.value = [...previous, {
      id: optimisticId,
      input,
      clientUserMessageId
    }]
    mutating.value = true
    error.value = null

    try {
      const response = await options.getClient().request<ThreadQueueAddResponse>('thread/queue/add', {
        threadId: mutation.threadId,
        input,
        clientUserMessageId
      } satisfies ThreadQueueAddParams)
      if (!isCurrentMutation(mutation)) {
        return response.queuedSubmission
      }
      submissions.value = submissions.value.map(submission =>
        submission.id === optimisticId ? response.queuedSubmission : submission
      )
      await refresh(true)
      return response.queuedSubmission
    } catch (caughtError) {
      await reconcileAfterMutationFailure('Adding the queued prompt', caughtError, previous, mutation)
      throw caughtError
    } finally {
      if (mutation.token === mutationSequence) {
        mutating.value = false
      }
    }
  }

  const update = async (queuedSubmissionId: string, text: string) => {
    const mutation = beginMutation()
    const previous = submissions.value.slice()
    const input = buildTextThreadQueueInput(text)
    submissions.value = submissions.value.map(submission =>
      submission.id === queuedSubmissionId ? { ...submission, input } : submission
    )
    mutating.value = true
    error.value = null

    try {
      const response = await options.getClient().request<ThreadQueueUpdateResponse>('thread/queue/update', {
        threadId: mutation.threadId,
        queuedSubmissionId,
        input
      } satisfies ThreadQueueUpdateParams)
      if (!isCurrentMutation(mutation)) {
        return response.queuedSubmission
      }
      submissions.value = submissions.value.map(submission =>
        submission.id === queuedSubmissionId ? response.queuedSubmission : submission
      )
      await refresh(true)
      return response.queuedSubmission
    } catch (caughtError) {
      await reconcileAfterMutationFailure('Updating the queued prompt', caughtError, previous, mutation)
      throw caughtError
    } finally {
      if (mutation.token === mutationSequence) {
        mutating.value = false
      }
    }
  }

  const remove = async (queuedSubmissionId: string) => {
    const mutation = beginMutation()
    const previous = submissions.value.slice()
    submissions.value = submissions.value.filter(submission => submission.id !== queuedSubmissionId)
    mutating.value = true
    error.value = null

    try {
      const response = await options.getClient().request<ThreadQueueDeleteResponse>('thread/queue/delete', {
        threadId: mutation.threadId,
        queuedSubmissionId
      } satisfies ThreadQueueDeleteParams)
      if (!isCurrentMutation(mutation)) {
        return response.deleted
      }
      await refresh(true)
      return response.deleted
    } catch (caughtError) {
      await reconcileAfterMutationFailure('Deleting the queued prompt', caughtError, previous, mutation)
      throw caughtError
    } finally {
      if (mutation.token === mutationSequence) {
        mutating.value = false
      }
    }
  }

  const reorder = async (queuedSubmissionIds: string[]) => {
    const mutation = beginMutation()
    const previous = submissions.value.slice()
    const byId = new Map(previous.map(submission => [submission.id, submission]))
    const optimistic = queuedSubmissionIds
      .map(id => byId.get(id))
      .filter((submission): submission is QueuedSubmission => Boolean(submission))
    if (optimistic.length !== previous.length) {
      throw new Error('The queue changed before it could be reordered. Refresh and try again.')
    }
    submissions.value = optimistic
    mutating.value = true
    error.value = null

    try {
      await options.getClient().request<ThreadQueueReorderResponse>('thread/queue/reorder', {
        threadId: mutation.threadId,
        queuedSubmissionIds
      } satisfies ThreadQueueReorderParams)
      if (isCurrentMutation(mutation)) {
        await refresh(true)
      }
    } catch (caughtError) {
      await reconcileAfterMutationFailure('Reordering the prompt queue', caughtError, previous, mutation)
      throw caughtError
    } finally {
      if (mutation.token === mutationSequence) {
        mutating.value = false
      }
    }
  }

  const start = async (queuedSubmissionId?: string) => {
    const mutation = beginMutation()
    const previous = submissions.value.slice()
    mutating.value = true
    error.value = null

    try {
      const response = await options.getClient().request<ThreadQueueStartResponse>('thread/queue/start', {
        threadId: mutation.threadId,
        queuedSubmissionId: queuedSubmissionId ?? null
      } satisfies ThreadQueueStartParams)
      if (!isCurrentMutation(mutation)) {
        return response.turn
      }
      automaticDispatchPaused = false
      paused.value = false
      await refresh(true)
      return response.turn
    } catch (caughtError) {
      await reconcileAfterMutationFailure('Starting the queued prompt', caughtError, previous, mutation)
      throw caughtError
    } finally {
      if (mutation.token === mutationSequence) {
        mutating.value = false
      }
    }
  }

  const handleNotification = (notification: CodexRpcNotification) => {
    if (notification.method !== 'thread/queue/changed') {
      return
    }
    const params = notification.params as { threadId?: unknown }
    if (params.threadId === selectedThreadId) {
      void refresh(true)
    }
  }

  const handleConnectionState = (state: CodexRpcConnectionState) => {
    if (state === 'disconnected') {
      disconnected = true
      return
    }
    if (state === 'connected' && disconnected) {
      disconnected = false
      void refresh(true)
    }
  }

  const markTurnStarted = () => {
    automaticDispatchPaused = false
    paused.value = false
  }

  const markTurnCompleted = (turnStatus: string | null) => {
    automaticDispatchPaused = turnStatus === 'interrupted'
    paused.value = automaticDispatchPaused && submissions.value.length > 0
    void refresh(true)
  }

  const restoreFromTurnStatus = (turnStatus: string | null | undefined) => {
    automaticDispatchPaused = turnStatus === 'interrupted'
    paused.value = automaticDispatchPaused && submissions.value.length > 0
  }

  const stopThreadWatch = watch(options.threadId, (threadId) => {
    contextGeneration += 1
    mutationSequence += 1
    selectedThreadId = threadId
    refreshPromise = null
    refreshRequested = false
    submissions.value = []
    supported.value = null
    loading.value = false
    mutating.value = false
    error.value = null
    automaticDispatchPaused = threadId
      ? options.getLastTurnStatus?.(threadId) === 'interrupted'
      : false
    paused.value = false
    if (threadId) {
      void refresh()
    }
  }, { immediate: true })

  return {
    submissions,
    supported,
    loading,
    mutating,
    error,
    paused,
    refresh,
    add,
    update,
    remove,
    reorder,
    start,
    handleNotification,
    handleConnectionState,
    markTurnStarted,
    markTurnCompleted,
    restoreFromTurnStatus,
    dispose: stopThreadWatch
  }
}

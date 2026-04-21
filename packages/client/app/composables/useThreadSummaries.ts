import { ref, type Ref } from 'vue'
import type { Thread } from '~~/shared/generated/codex-app-server/v2/Thread'

export type ThreadSummary = {
  id: string
  title: string
  updatedAt: number
}

type ThreadSummariesState = {
  threads: Ref<ThreadSummary[]>
  loading: Ref<boolean>
  error: Ref<string | null>
}

type UseThreadSummariesResult = ThreadSummariesState & {
  setThreads: (nextThreads: ThreadSummary[]) => void
  setLoading: (nextLoading: boolean) => void
  setError: (nextError: string | null) => void
  syncThreadSummary: (thread: Pick<Thread, 'id' | 'name' | 'preview' | 'updatedAt'>) => void
  updateThreadSummaryTitle: (threadId: string, title: string, updatedAt?: number) => void
}

const states = new Map<string, ThreadSummariesState>()

export const normalizeThreadTitleCandidate = (value: string | null | undefined) => {
  const raw = value?.trim() ?? ''
  if (!raw) {
    return ''
  }

  const stripped = raw
    .replace(/<\/?[a-z_]+>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!stripped) {
    return ''
  }

  if (
    /<(?:user_action|context)>/i.test(raw)
    || /user initiated a review task/i.test(stripped)
    || /review output from reviewer mode/i.test(stripped)
  ) {
    return 'Code Review'
  }

  return stripped
}

export const resolveThreadSummaryTitle = (thread: Pick<Thread, 'id' | 'name' | 'preview'>) => {
  const nextTitle = normalizeThreadTitleCandidate(thread.name) || normalizeThreadTitleCandidate(thread.preview)
  return nextTitle || `Thread ${thread.id}`
}

export const mergeThreadSummary = (threads: ThreadSummary[], nextThread: ThreadSummary) => {
  const filtered = threads.filter(thread => thread.id !== nextThread.id)
  return [...filtered, nextThread].sort((left, right) => right.updatedAt - left.updatedAt)
}

export const renameThreadSummary = (
  threads: ThreadSummary[],
  input: {
    threadId: string
    title: string
    updatedAt?: number
  }
) => {
  const nextTitle = normalizeThreadTitleCandidate(input.title)
  if (!nextTitle) {
    return threads
  }

  const existing = threads.find(thread => thread.id === input.threadId)
  return mergeThreadSummary(threads, {
    id: input.threadId,
    title: nextTitle,
    updatedAt: input.updatedAt ?? existing?.updatedAt ?? Date.now()
  })
}

const createState = (): ThreadSummariesState => ({
  threads: ref<ThreadSummary[]>([]),
  loading: ref(false),
  error: ref<string | null>(null)
})

const createApi = (state: ThreadSummariesState): UseThreadSummariesResult => ({
  ...state,
  setThreads: (nextThreads: ThreadSummary[]) => {
    state.threads.value = [...nextThreads].sort((left, right) => right.updatedAt - left.updatedAt)
  },
  setLoading: (nextLoading: boolean) => {
    state.loading.value = nextLoading
  },
  setError: (nextError: string | null) => {
    state.error.value = nextError
  },
  syncThreadSummary: (thread: Pick<Thread, 'id' | 'name' | 'preview' | 'updatedAt'>) => {
    state.threads.value = mergeThreadSummary(state.threads.value, {
      id: thread.id,
      title: resolveThreadSummaryTitle(thread),
      updatedAt: thread.updatedAt
    })
  },
  updateThreadSummaryTitle: (threadId: string, title: string, updatedAt?: number) => {
    state.threads.value = renameThreadSummary(state.threads.value, {
      threadId,
      title,
      updatedAt
    })
  }
})

export const useThreadSummaries = (projectId: string): UseThreadSummariesResult => {
  const existing = states.get(projectId)
  if (existing) {
    return createApi(existing)
  }

  const state = createState()
  states.set(projectId, state)
  return createApi(state)
}

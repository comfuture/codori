import { ref, type Ref } from 'vue'
import type { Thread } from '~~/shared/generated/codex-app-server/v2/Thread'
import type { ThreadActiveFlag } from '~~/shared/generated/codex-app-server/v2/ThreadActiveFlag'
import type { ThreadStatus } from '~~/shared/generated/codex-app-server/v2/ThreadStatus'

export type ThreadSummaryStatus = ThreadStatus | { type: 'unknown' }

export type ThreadSummary = {
  id: string
  title: string
  updatedAt: number
  status: ThreadSummaryStatus
}

export type ThreadSummaryInput = Omit<ThreadSummary, 'status'> & {
  status?: unknown
}

export type ThreadSummaryHydrationOptions = {
  statusRevision?: number
}

type ThreadSummaryThreadInput = Pick<Thread, 'id' | 'name' | 'preview' | 'updatedAt'> & {
  status?: unknown
}

type ThreadStatusOverride = {
  revision: number
  status: ThreadSummaryStatus
}

type ThreadSummariesPublicState = {
  threads: Ref<ThreadSummary[]>
  loading: Ref<boolean>
  error: Ref<string | null>
}

type ThreadSummariesState = ThreadSummariesPublicState & {
  statusRevision: number
  statusOverrides: Map<string, ThreadStatusOverride>
}

type UseThreadSummariesResult = ThreadSummariesPublicState & {
  setThreads: (nextThreads: ThreadSummaryInput[], options?: ThreadSummaryHydrationOptions) => void
  setLoading: (nextLoading: boolean) => void
  setError: (nextError: string | null) => void
  getStatusRevision: () => number
  syncThreadSummary: (thread: ThreadSummaryThreadInput, options?: ThreadSummaryHydrationOptions) => void
  updateThreadSummaryTitle: (threadId: string, title: string, updatedAt?: number) => void
  updateThreadSummaryStatus: (threadId: string, status: unknown) => void
  removeThreadSummary: (threadId: string) => void
}

const states = new Map<string, ThreadSummariesState>()

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isThreadActiveFlag = (value: unknown): value is ThreadActiveFlag =>
  value === 'waitingOnApproval' || value === 'waitingOnUserInput'

export const normalizeThreadSummaryStatus = (value: unknown): ThreadSummaryStatus => {
  if (!isObjectRecord(value)) {
    return { type: 'unknown' }
  }

  switch (value.type) {
    case 'notLoaded':
    case 'idle':
    case 'systemError':
      return { type: value.type }
    case 'active':
      return {
        type: 'active',
        activeFlags: Array.isArray(value.activeFlags)
          ? value.activeFlags.filter(isThreadActiveFlag)
          : []
      }
    default:
      return { type: 'unknown' }
  }
}

// Codex app-server defines ThreadStatus.active as an authoritative running
// snapshot. Live turn events reinforce this state in ProjectSidebar so a
// terminal turn notification can stop the indicator even if an idle status
// notification is missed.
export const isThreadSummaryRunning = (status: ThreadSummaryStatus) => status.type === 'active'

export const normalizeThreadTitleCandidate = (value: string | null | undefined) => {
  const raw = value?.trim() ?? ''
  if (!raw) {
    return ''
  }

  const stripped = raw
    // Submitted app and plugin mentions are Markdown links. Thread titles are
    // plain text, so preserve only the user-visible label.
    .replace(/\[([^\]\r\n]+)\]\((?:\\.|[^\\()\r\n]|\([^()\r\n]*\))*\)/g, '$1')
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

export function mergeThreadSummary(threads: ThreadSummary[], nextThread: ThreadSummary): ThreadSummary[]
export function mergeThreadSummary(threads: ThreadSummaryInput[], nextThread: ThreadSummaryInput): ThreadSummaryInput[]
export function mergeThreadSummary(threads: ThreadSummaryInput[], nextThread: ThreadSummaryInput) {
  const filtered = threads.filter(thread => thread.id !== nextThread.id)
  return [...filtered, nextThread].sort((left, right) => right.updatedAt - left.updatedAt)
}

export function renameThreadSummary(
  threads: ThreadSummary[],
  input: {
    threadId: string
    title: string
    updatedAt?: number
  }
): ThreadSummary[]
export function renameThreadSummary(
  threads: ThreadSummaryInput[],
  input: {
    threadId: string
    title: string
    updatedAt?: number
  }
): ThreadSummaryInput[]
export function renameThreadSummary(
  threads: ThreadSummaryInput[],
  input: {
    threadId: string
    title: string
    updatedAt?: number
  }
) {
  const nextTitle = normalizeThreadTitleCandidate(input.title)
  if (!nextTitle) {
    return threads
  }

  const existing = threads.find(thread => thread.id === input.threadId)
  const nextThread: ThreadSummaryInput = {
    ...existing,
    id: input.threadId,
    title: nextTitle,
    updatedAt: input.updatedAt ?? existing?.updatedAt ?? Date.now()
  }
  if (!existing || 'status' in existing) {
    nextThread.status = existing?.status ?? { type: 'unknown' }
  }

  return mergeThreadSummary(threads, nextThread)
}

const createState = (): ThreadSummariesState => ({
  threads: ref<ThreadSummary[]>([]),
  loading: ref(false),
  error: ref<string | null>(null),
  statusRevision: 0,
  statusOverrides: new Map<string, ThreadStatusOverride>()
})

export const resolveProjectThreadSummaryKey = (projectId: string | null) =>
  projectId ? `project:${projectId}` : '__missing-project__'

const resolveHydratedStatus = (
  state: ThreadSummariesState,
  threadId: string,
  incomingStatus: unknown,
  existingStatus: ThreadSummaryStatus | undefined,
  options?: ThreadSummaryHydrationOptions
) => {
  const statusOverride = state.statusOverrides.get(threadId)
  const shouldPreserveOverride = statusOverride && (
    options?.statusRevision === undefined
    || statusOverride.revision > options.statusRevision
  )
  if (shouldPreserveOverride) {
    return statusOverride.status
  }

  if (statusOverride) {
    state.statusOverrides.delete(threadId)
  }

  const normalizedStatus = normalizeThreadSummaryStatus(incomingStatus)
  return normalizedStatus.type === 'unknown' && existingStatus
    ? existingStatus
    : normalizedStatus
}

const createApi = (state: ThreadSummariesState): UseThreadSummariesResult => ({
  threads: state.threads,
  loading: state.loading,
  error: state.error,
  setThreads: (nextThreads: ThreadSummaryInput[], options?: ThreadSummaryHydrationOptions) => {
    const existingById = new Map(state.threads.value.map(thread => [thread.id, thread]))
    state.threads.value = nextThreads.map(thread => ({
      ...thread,
      status: resolveHydratedStatus(
        state,
        thread.id,
        thread.status,
        existingById.get(thread.id)?.status,
        options
      )
    })).sort((left, right) => right.updatedAt - left.updatedAt)
  },
  setLoading: (nextLoading: boolean) => {
    state.loading.value = nextLoading
  },
  setError: (nextError: string | null) => {
    state.error.value = nextError
  },
  getStatusRevision: () => state.statusRevision,
  syncThreadSummary: (thread: ThreadSummaryThreadInput, options?: ThreadSummaryHydrationOptions) => {
    const existing = state.threads.value.find(summary => summary.id === thread.id)
    state.threads.value = mergeThreadSummary(state.threads.value, {
      id: thread.id,
      title: resolveThreadSummaryTitle(thread),
      updatedAt: thread.updatedAt,
      status: resolveHydratedStatus(state, thread.id, thread.status, existing?.status, options)
    })
  },
  updateThreadSummaryTitle: (threadId: string, title: string, updatedAt?: number) => {
    state.threads.value = renameThreadSummary(state.threads.value, {
      threadId,
      title,
      updatedAt
    })
  },
  updateThreadSummaryStatus: (threadId: string, status: unknown) => {
    state.statusRevision += 1
    const normalizedStatus = normalizeThreadSummaryStatus(status)
    state.statusOverrides.set(threadId, {
      revision: state.statusRevision,
      status: normalizedStatus
    })
    state.threads.value = state.threads.value.map(thread =>
      thread.id === threadId
        ? { ...thread, status: normalizedStatus }
        : thread
    )
  },
  removeThreadSummary: (threadId: string) => {
    state.statusOverrides.delete(threadId)
    state.threads.value = state.threads.value.filter(thread => thread.id !== threadId)
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

export const promoteThreadSummaries = (sourceProjectId: string, targetProjectId: string) => {
  if (sourceProjectId === targetProjectId || states.has(targetProjectId)) {
    return
  }

  const state = states.get(sourceProjectId)
  if (!state) {
    return
  }

  states.set(targetProjectId, state)
  states.delete(sourceProjectId)
}

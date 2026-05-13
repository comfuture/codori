import { computed, ref, type Ref } from 'vue'
import {
  applyThreadGoalCleared,
  applyThreadGoalUpdated,
  normalizeThreadGoal
} from '~~/shared/thread-goal'
import type { LiveStream } from './useChatSession'
import type { ThreadGoal } from '~~/shared/generated/codex-app-server/v2/ThreadGoal'
import type { ThreadGoalClearParams } from '~~/shared/generated/codex-app-server/v2/ThreadGoalClearParams'
import type { ThreadGoalClearResponse } from '~~/shared/generated/codex-app-server/v2/ThreadGoalClearResponse'
import type { ThreadGoalGetParams } from '~~/shared/generated/codex-app-server/v2/ThreadGoalGetParams'
import type { ThreadGoalGetResponse } from '~~/shared/generated/codex-app-server/v2/ThreadGoalGetResponse'
import type { ThreadGoalSetParams } from '~~/shared/generated/codex-app-server/v2/ThreadGoalSetParams'
import type { ThreadGoalSetResponse } from '~~/shared/generated/codex-app-server/v2/ThreadGoalSetResponse'
import type { ThreadGoalStatus } from '~~/shared/generated/codex-app-server/v2/ThreadGoalStatus'

type GoalRpcClient = {
  request<T>(method: 'thread/goal/get', params: ThreadGoalGetParams): Promise<T>
  request<T>(method: 'thread/goal/set', params: ThreadGoalSetParams): Promise<T>
  request<T>(method: 'thread/goal/clear', params: ThreadGoalClearParams): Promise<T>
}

type UseChatGoalWorkflowOptions = {
  projectId: string
  activeThreadId: Ref<string | null>
  threadGoals: Ref<Record<string, ThreadGoal>>
  ensurePendingLiveStream: () => Promise<LiveStream>
  getClient: (projectId: string) => GoalRpcClient
  setComposerError: (messageText: string) => void
}

export const useChatGoalWorkflow = (options: UseChatGoalWorkflowOptions) => {
  const goalDrawerOpen = ref(false)
  const goalDrawerMode = ref<'summary' | 'edit'>('summary')
  const goalDrawerLoading = ref(false)
  const goalDrawerSubmitting = ref(false)
  const goalDrawerError = ref<string | null>(null)
  const goalDraftObjective = ref('')

  const currentThreadGoal = computed(() => {
    const threadId = options.activeThreadId.value
    return threadId ? options.threadGoals.value[threadId] ?? null : null
  })

  const setThreadGoalState = (goal: ThreadGoal) => {
    options.threadGoals.value = {
      ...options.threadGoals.value,
      [goal.threadId]: goal
    }
  }

  const clearThreadGoalState = (threadId: string) => {
    if (!(threadId in options.threadGoals.value)) {
      return
    }

    const nextGoals = { ...options.threadGoals.value }
    delete nextGoals[threadId]
    options.threadGoals.value = nextGoals
  }

  const applyThreadGoalUpdatedNotification = (params: unknown) => {
    options.threadGoals.value = applyThreadGoalUpdated(options.threadGoals.value, params)
  }

  const applyThreadGoalClearedNotification = (params: unknown) => {
    options.threadGoals.value = applyThreadGoalCleared(options.threadGoals.value, params)
  }

  const ensureGoalThreadId = async () => {
    const liveStream = await options.ensurePendingLiveStream()
    return liveStream.threadId
  }

  const getGoal = async (threadId: string) => {
    const response = await options.getClient(options.projectId).request<ThreadGoalGetResponse>('thread/goal/get', {
      threadId
    })
    const goal = normalizeThreadGoal(response.goal)
    if (goal) {
      setThreadGoalState(goal)
    } else {
      clearThreadGoalState(threadId)
    }
    return goal
  }

  const openGoalSummary = async () => {
    goalDrawerMode.value = 'summary'
    goalDrawerOpen.value = true
    goalDrawerLoading.value = true
    goalDrawerError.value = null

    try {
      const threadId = await ensureGoalThreadId()
      await getGoal(threadId)
    } catch (caughtError) {
      goalDrawerError.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    } finally {
      goalDrawerLoading.value = false
    }
  }

  const setGoalObjective = async (objective: string, input?: { openSummary?: boolean }) => {
    const trimmedObjective = objective.trim()
    if (!trimmedObjective) {
      options.setComposerError('Goal objective must not be empty.')
      return
    }

    goalDrawerSubmitting.value = true
    goalDrawerError.value = null

    try {
      const threadId = await ensureGoalThreadId()
      const response = await options.getClient(options.projectId).request<ThreadGoalSetResponse>('thread/goal/set', {
        threadId,
        objective: trimmedObjective,
        status: 'active'
      })
      setThreadGoalState(response.goal)
      goalDraftObjective.value = response.goal.objective
      if (input?.openSummary) {
        goalDrawerMode.value = 'summary'
        goalDrawerOpen.value = true
      }
    } catch (caughtError) {
      const messageText = caughtError instanceof Error ? caughtError.message : String(caughtError)
      goalDrawerError.value = messageText
      options.setComposerError(messageText)
    } finally {
      goalDrawerSubmitting.value = false
    }
  }

  const setGoalStatus = async (status: Extract<ThreadGoalStatus, 'active' | 'paused'>) => {
    goalDrawerSubmitting.value = true
    goalDrawerError.value = null

    try {
      const threadId = await ensureGoalThreadId()
      const response = await options.getClient(options.projectId).request<ThreadGoalSetResponse>('thread/goal/set', {
        threadId,
        status
      })
      setThreadGoalState(response.goal)
      goalDrawerMode.value = 'summary'
      goalDrawerOpen.value = true
    } catch (caughtError) {
      const messageText = caughtError instanceof Error ? caughtError.message : String(caughtError)
      goalDrawerError.value = messageText
      options.setComposerError(messageText)
    } finally {
      goalDrawerSubmitting.value = false
    }
  }

  const clearGoal = async () => {
    goalDrawerSubmitting.value = true
    goalDrawerError.value = null

    try {
      const threadId = await ensureGoalThreadId()
      await options.getClient(options.projectId).request<ThreadGoalClearResponse>('thread/goal/clear', {
        threadId
      })
      clearThreadGoalState(threadId)
      goalDrawerMode.value = 'summary'
      goalDrawerOpen.value = true
    } catch (caughtError) {
      const messageText = caughtError instanceof Error ? caughtError.message : String(caughtError)
      goalDrawerError.value = messageText
      options.setComposerError(messageText)
    } finally {
      goalDrawerSubmitting.value = false
    }
  }

  const openGoalEditor = async () => {
    goalDrawerOpen.value = true
    goalDrawerMode.value = 'edit'
    goalDrawerError.value = null
    goalDrawerLoading.value = true

    try {
      const threadId = await ensureGoalThreadId()
      const goal = currentThreadGoal.value ?? await getGoal(threadId)
      if (!goal) {
        goalDrawerMode.value = 'summary'
        goalDrawerError.value = 'No goal is currently set for this thread.'
        goalDraftObjective.value = ''
        return
      }

      goalDraftObjective.value = goal.objective
    } catch (caughtError) {
      goalDrawerError.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    } finally {
      goalDrawerLoading.value = false
    }
  }

  const saveGoalEdit = async (objective: string) => {
    await setGoalObjective(objective, { openSummary: true })
  }

  const handleGoalDrawerOpenChange = (open: boolean) => {
    goalDrawerOpen.value = open
    if (!open) {
      goalDrawerMode.value = 'summary'
      goalDrawerError.value = null
      goalDraftObjective.value = ''
    }
  }

  return {
    goalDrawerOpen,
    goalDrawerMode,
    goalDrawerLoading,
    goalDrawerSubmitting,
    goalDrawerError,
    goalDraftObjective,
    currentThreadGoal,
    applyThreadGoalUpdatedNotification,
    applyThreadGoalClearedNotification,
    openGoalSummary,
    setGoalObjective,
    setGoalStatus,
    clearGoal,
    openGoalEditor,
    saveGoalEdit,
    handleGoalDrawerOpenChange
  }
}

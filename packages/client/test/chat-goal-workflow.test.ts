import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatGoalWorkflow } from '../app/composables/useChatGoalWorkflow'
import type { ThreadGoal } from '../shared/generated/codex-app-server/v2/ThreadGoal'

const testGoal = (overrides: Partial<ThreadGoal> = {}): ThreadGoal => ({
  threadId: 'thread-1',
  objective: 'Ship goal support',
  status: 'active',
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: 1,
  updatedAt: 2,
  ...overrides
})

describe('chat goal workflow', () => {
  const request = vi.fn()
  const ensurePendingLiveStream = vi.fn()
  const setComposerError = vi.fn()

  beforeEach(() => {
    request.mockReset()
    ensurePendingLiveStream.mockReset()
    setComposerError.mockReset()
    ensurePendingLiveStream.mockResolvedValue({
      threadId: 'thread-1',
      turnId: null,
      lockedTurnId: null,
      bufferedNotifications: [],
      observedSubagentThreadIds: new Set(),
      pendingUserMessageIds: [],
      turnIdWaiters: [],
      interruptRequested: false,
      interruptAcknowledged: false,
      unsubscribe: null
    })
  })

  const createWorkflow = () => {
    const activeThreadId = ref<string | null>('thread-1')
    const threadGoals = ref<Record<string, ThreadGoal>>({})
    const workflow = useChatGoalWorkflow({
      projectId: 'codori',
      activeThreadId,
      threadGoals,
      ensurePendingLiveStream,
      getClient: () => ({ request }),
      setComposerError
    })

    return {
      activeThreadId,
      threadGoals,
      workflow
    }
  }

  it('loads the current thread goal for bare /goal', async () => {
    const { threadGoals, workflow } = createWorkflow()
    request.mockResolvedValue({
      goal: testGoal({ objective: 'Keep the goal visible' })
    })

    await workflow.openGoalSummary()

    expect(request).toHaveBeenCalledWith('thread/goal/get', {
      threadId: 'thread-1'
    })
    expect(threadGoals.value['thread-1']?.objective).toBe('Keep the goal visible')
    expect(workflow.goalDrawerOpen.value).toBe(true)
    expect(workflow.goalDrawerLoading.value).toBe(false)
  })

  it('sets an active thread goal from inline /goal text', async () => {
    const { threadGoals, workflow } = createWorkflow()
    request.mockResolvedValue({
      goal: testGoal({ objective: 'Ship issue #68' })
    })

    await workflow.setGoalObjective(' Ship issue #68 ')

    expect(request).toHaveBeenCalledWith('thread/goal/set', {
      threadId: 'thread-1',
      objective: 'Ship issue #68',
      status: 'active'
    })
    expect(threadGoals.value['thread-1']?.objective).toBe('Ship issue #68')
  })

  it('updates goal status and clears goals through native RPCs', async () => {
    const { threadGoals, workflow } = createWorkflow()
    threadGoals.value = {
      'thread-1': testGoal()
    }
    request.mockResolvedValueOnce({
      goal: testGoal({ status: 'paused' })
    })
    request.mockResolvedValueOnce({
      cleared: true
    })

    await workflow.setGoalStatus('paused')
    await workflow.clearGoal()

    expect(request).toHaveBeenNthCalledWith(1, 'thread/goal/set', {
      threadId: 'thread-1',
      status: 'paused'
    })
    expect(request).toHaveBeenNthCalledWith(2, 'thread/goal/clear', {
      threadId: 'thread-1'
    })
    expect(threadGoals.value).toEqual({})
  })

  it('applies goal update and clear notifications to local state', () => {
    const { threadGoals, workflow } = createWorkflow()

    workflow.applyThreadGoalUpdatedNotification({
      threadId: 'thread-1',
      turnId: null,
      goal: testGoal({ status: 'complete' })
    })
    expect(threadGoals.value['thread-1']?.status).toBe('complete')

    workflow.applyThreadGoalClearedNotification({
      threadId: 'thread-1'
    })
    expect(threadGoals.value).toEqual({})
  })

  it('surfaces unsupported goal errors without falling back to chat text', async () => {
    const { workflow } = createWorkflow()
    request.mockRejectedValue(new Error('goals feature is disabled'))

    await workflow.setGoalObjective('Ship issue #68')

    expect(setComposerError).toHaveBeenCalledWith('goals feature is disabled')
    expect(workflow.goalDrawerError.value).toBe('goals feature is disabled')
  })
})

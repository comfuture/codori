import { computed, nextTick, watch, type ComputedRef, type Ref } from 'vue'
import type { ReasoningEffort } from '~~/shared/chat-prompt-controls'
import {
  buildCollaborationModeFromMask,
  findCollaborationModeMask,
  normalizeCollaborationModeListResponse,
  resolveThreadCollaborationModeKey,
  type CollaborationMode,
  type CollaborationModeListResponse,
  type CollaborationModeMask
} from '~~/shared/collaboration-mode'
import { shouldQueuePlanImplementationPrompt } from '~~/shared/plan-implementation-prompt'
import {
  applyTurnPlanUpdate,
  normalizeTurnPlanUpdate,
  shouldResetThreadPlanState,
  type ThreadPlanState
} from '~~/shared/turn-plan'

type CollaborationModeClient = {
  request<T>(method: 'collaborationMode/list', params: Record<string, never>): Promise<T>
}

type UseChatPlanWorkflowOptions = {
  projectId: string
  routeThreadId: Ref<string | null>
  activeThreadId: Ref<string | null>
  hasPendingRequest: Ref<boolean>
  isBusy: ComputedRef<boolean>
  selectedProjectStatus: ComputedRef<string | null>
  selectedModel: Ref<string>
  selectedEffort: Ref<ReasoningEffort>
  threadPlans: Ref<Record<string, ThreadPlanState>>
  threadCollaborationModeMasks: Ref<Record<string, CollaborationModeMask>>
  collaborationModeMasks: Ref<CollaborationModeMask[]>
  collaborationModesLoaded: Ref<boolean>
  collaborationModesLoading: Ref<boolean>
  collaborationModesError: Ref<string | null>
  latestPlanTurnId: Ref<string | null>
  queuedPlanImplementationPromptTurnId: Ref<string | null>
  queuedPlanImplementationPromptThreadId: Ref<string | null>
  planImplementationPromptTurnId: Ref<string | null>
  planImplementationPromptThreadId: Ref<string | null>
  shownPlanImplementationPromptTurnIds: Set<string>
  ensureProjectRuntime: () => Promise<void>
  getClient: (projectId: string) => CollaborationModeClient
}

export const useChatPlanWorkflow = (options: UseChatPlanWorkflowOptions) => {
  const currentThreadCollaborationModeKey = computed(() =>
    resolveThreadCollaborationModeKey(options.activeThreadId.value ?? options.routeThreadId.value)
  )
  const currentPlanPromptThreadId = computed(() =>
    options.activeThreadId.value ?? options.routeThreadId.value
  )
  const isPlanImplementationPromptOpen = computed(() =>
    Boolean(
      options.planImplementationPromptTurnId.value
      && options.planImplementationPromptThreadId.value === currentPlanPromptThreadId.value
    )
  )
  const currentThreadCollaborationModeMask = computed(() =>
    options.threadCollaborationModeMasks.value[currentThreadCollaborationModeKey.value] ?? null
  )
  const planCollaborationModeMask = computed(() =>
    findCollaborationModeMask(options.collaborationModeMasks.value, 'plan')
  )
  const currentCollaborationModeLabel = computed(() =>
    currentThreadCollaborationModeMask.value?.mode === 'plan'
      ? currentThreadCollaborationModeMask.value.name
      : null
  )
  const isPlanModeActive = computed(() =>
    currentThreadCollaborationModeMask.value?.mode === 'plan'
  )
  const currentThreadPlan = computed(() => {
    const threadId = options.activeThreadId.value ?? options.routeThreadId.value
    if (!threadId) {
      return null
    }

    return options.threadPlans.value[threadId] ?? null
  })

  const setThreadPlanPanelOpen = (open: boolean) => {
    if (!currentThreadPlan.value?.threadId) {
      return
    }

    options.threadPlans.value = {
      ...options.threadPlans.value,
      [currentThreadPlan.value.threadId]: {
        ...currentThreadPlan.value,
        panelOpen: open
      }
    }
  }

  const clearThreadPlanState = (threadId: string) => {
    if (!(threadId in options.threadPlans.value)) {
      return
    }

    const nextThreadPlans = { ...options.threadPlans.value }
    delete nextThreadPlans[threadId]
    options.threadPlans.value = nextThreadPlans
  }

  const updateThreadPlanState = (threadId: string, params: unknown) => {
    const nextPlanUpdate = normalizeTurnPlanUpdate(params)
    if (!nextPlanUpdate) {
      return
    }

    const nextPlanState = applyTurnPlanUpdate(options.threadPlans.value[threadId], {
      ...nextPlanUpdate,
      threadId
    })
    if (!nextPlanState) {
      clearThreadPlanState(threadId)
      return
    }

    options.threadPlans.value = {
      ...options.threadPlans.value,
      [threadId]: nextPlanState
    }
  }

  const shouldResetThreadPlanForTurn = (threadId: string, nextTurnId: string | null) =>
    shouldResetThreadPlanState(options.threadPlans.value[threadId], nextTurnId)

  const setThreadCollaborationModeMask = (
    threadId: string | null | undefined,
    mask: CollaborationModeMask | null
  ) => {
    const key = resolveThreadCollaborationModeKey(threadId)
    const nextThreadModes = { ...options.threadCollaborationModeMasks.value }

    if (mask) {
      nextThreadModes[key] = mask
    } else {
      delete nextThreadModes[key]
    }

    options.threadCollaborationModeMasks.value = nextThreadModes
  }

  const moveDraftCollaborationModeToThread = (threadId: string) => {
    const draftKey = resolveThreadCollaborationModeKey(null)
    const draftMode = options.threadCollaborationModeMasks.value[draftKey]
    if (!draftMode) {
      return
    }

    const nextThreadModes = { ...options.threadCollaborationModeMasks.value }
    nextThreadModes[threadId] = draftMode
    delete nextThreadModes[draftKey]
    options.threadCollaborationModeMasks.value = nextThreadModes
  }

  const buildCurrentTurnCollaborationMode = (): CollaborationMode | null =>
    buildCollaborationModeFromMask(currentThreadCollaborationModeMask.value, {
      model: options.selectedModel.value,
      reasoning_effort: options.selectedEffort.value
    })

  let pendingCollaborationModesLoad: Promise<void> | null = null

  const loadCollaborationModes = async (loadOptions?: { force?: boolean }) => {
    if (options.collaborationModesLoaded.value && !loadOptions?.force) {
      return
    }

    if (pendingCollaborationModesLoad) {
      await pendingCollaborationModesLoad
      return
    }

    const loadPromise = (async () => {
      options.collaborationModesLoading.value = true
      options.collaborationModesError.value = null

      try {
        await options.ensureProjectRuntime()
        const response = await options.getClient(options.projectId).request<CollaborationModeListResponse>('collaborationMode/list', {})
        options.collaborationModeMasks.value = normalizeCollaborationModeListResponse(response)
      } catch (caughtError) {
        options.collaborationModeMasks.value = []
        options.collaborationModesError.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
      } finally {
        options.collaborationModesLoaded.value = true
        options.collaborationModesLoading.value = false
      }
    })()

    pendingCollaborationModesLoad = loadPromise

    try {
      await loadPromise
    } finally {
      if (pendingCollaborationModesLoad === loadPromise) {
        pendingCollaborationModesLoad = null
      }
    }
  }

  const ensurePlanModeAvailable = async () => {
    if (
      !options.collaborationModesLoaded.value
      || (options.collaborationModesLoading.value && !planCollaborationModeMask.value)
    ) {
      await loadCollaborationModes()
    }

    if (!planCollaborationModeMask.value && options.collaborationModesError.value) {
      await loadCollaborationModes({ force: true })
    }

    if (planCollaborationModeMask.value) {
      return planCollaborationModeMask.value
    }

    throw new Error(options.collaborationModesError.value ?? 'Plan mode is unavailable in the current runtime.')
  }

  const setCurrentThreadCollaborationMode = async (mode: 'plan' | 'default') => {
    if (options.isBusy.value) {
      throw new Error('Cannot switch collaboration mode while a turn is running.')
    }

    await loadCollaborationModes()
    if (options.collaborationModesError.value && !findCollaborationModeMask(options.collaborationModeMasks.value, mode)) {
      await loadCollaborationModes({ force: true })
    }
    const mask = findCollaborationModeMask(options.collaborationModeMasks.value, mode)
    if (!mask) {
      throw new Error(
        mode === 'plan'
          ? options.collaborationModesError.value ?? 'Plan mode is unavailable in the current runtime.'
          : options.collaborationModesError.value ?? 'Default collaboration mode is unavailable in the current runtime.'
      )
    }

    setThreadCollaborationModeMask(options.activeThreadId.value ?? options.routeThreadId.value, mask)
  }

  let planImplementationPromptFlushToken = 0

  const closePlanImplementationPrompt = () => {
    planImplementationPromptFlushToken += 1
    options.queuedPlanImplementationPromptTurnId.value = null
    options.queuedPlanImplementationPromptThreadId.value = null
    options.planImplementationPromptTurnId.value = null
    options.planImplementationPromptThreadId.value = null
  }

  const flushPlanImplementationPrompt = async () => {
    if (
      !options.queuedPlanImplementationPromptTurnId.value
      || !options.queuedPlanImplementationPromptThreadId.value
      || options.hasPendingRequest.value
    ) {
      return
    }

    const turnId = options.queuedPlanImplementationPromptTurnId.value
    const threadId = options.queuedPlanImplementationPromptThreadId.value
    if (options.shownPlanImplementationPromptTurnIds.has(turnId)) {
      options.queuedPlanImplementationPromptTurnId.value = null
      options.queuedPlanImplementationPromptThreadId.value = null
      return
    }

    if (currentPlanPromptThreadId.value !== threadId) {
      return
    }

    const flushToken = ++planImplementationPromptFlushToken
    await nextTick()
    if (
      flushToken !== planImplementationPromptFlushToken
      || options.hasPendingRequest.value
      || options.queuedPlanImplementationPromptTurnId.value !== turnId
      || options.queuedPlanImplementationPromptThreadId.value !== threadId
      || currentPlanPromptThreadId.value !== threadId
    ) {
      return
    }

    options.planImplementationPromptTurnId.value = turnId
    options.planImplementationPromptThreadId.value = threadId
  }

  const maybeQueuePlanImplementationPrompt = (input: {
    threadId: string | null
    turnId: string | null
    turnStatus: string | null | undefined
  }) => {
    if (!shouldQueuePlanImplementationPrompt({
      turnId: input.turnId,
      latestPlanTurnId: options.latestPlanTurnId.value,
      turnStatus: input.turnStatus
    })) {
      return
    }

    options.queuedPlanImplementationPromptThreadId.value = input.threadId
    options.queuedPlanImplementationPromptTurnId.value = input.turnId
    void flushPlanImplementationPrompt()
  }

  watch(options.hasPendingRequest, (nextValue) => {
    if (!nextValue) {
      void flushPlanImplementationPrompt()
    }
  })

  watch(currentPlanPromptThreadId, () => {
    void flushPlanImplementationPrompt()
  })

  watch(isPlanImplementationPromptOpen, (open) => {
    if (open && options.planImplementationPromptTurnId.value) {
      options.shownPlanImplementationPromptTurnIds.add(options.planImplementationPromptTurnId.value)
    }
  })

  watch(
    options.selectedProjectStatus,
    (projectStatus) => {
      if (
        projectStatus !== 'running'
        || options.collaborationModesLoaded.value
        || options.collaborationModesLoading.value
      ) {
        return
      }

      void loadCollaborationModes()
    },
    { immediate: true }
  )

  return {
    currentThreadCollaborationModeMask,
    planCollaborationModeMask,
    currentCollaborationModeLabel,
    isPlanModeActive,
    currentThreadPlan,
    isPlanImplementationPromptOpen,
    setThreadPlanPanelOpen,
    clearThreadPlanState,
    updateThreadPlanState,
    shouldResetThreadPlanForTurn,
    setThreadCollaborationModeMask,
    moveDraftCollaborationModeToThread,
    buildCurrentTurnCollaborationMode,
    loadCollaborationModes,
    ensurePlanModeAvailable,
    setCurrentThreadCollaborationMode,
    closePlanImplementationPrompt,
    maybeQueuePlanImplementationPrompt
  }
}

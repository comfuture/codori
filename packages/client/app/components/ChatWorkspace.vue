<script setup lang="ts">
import { useRouter, useRuntimeConfig } from '#imports'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from 'vue'
import MessageContent from './MessageContent.vue'
import ReviewStartDrawer from './ReviewStartDrawer.vue'
import PendingUserRequestDrawer from './PendingUserRequestDrawer.vue'
import UsageStatusModal from './UsageStatusModal.vue'
import {
  reconcileOptimisticUserMessage,
  removeChatMessage,
  removePendingUserMessageId,
  resolvePromptSubmitStatus,
  resolveTurnSubmissionMethod,
  shouldAdvanceLiveStreamTurn,
  shouldApplyNotificationToCurrentTurn,
  shouldSubmitViaTurnSteer,
  shouldAwaitThreadHydration,
  shouldRetrySteerWithTurnStart,
  shouldIgnoreNotificationAfterInterrupt
} from '../utils/chat-turn-engagement'
import { isFocusWithinContainer } from '../utils/slash-prompt-focus'
import { useChatAttachments, type DraftAttachment } from '../composables/useChatAttachments'
import { usePendingUserRequest } from '../composables/usePendingUserRequest'
import { useChatSession, type LiveStream, type SubagentPanelState } from '../composables/useChatSession'
import { useProjects } from '../composables/useProjects'
import { useRpc } from '../composables/useRpc'
import { useChatSubmitGuard } from '../composables/useChatSubmitGuard'
import {
  normalizeThreadTitleCandidate,
  resolveThreadSummaryTitle,
  useThreadSummaries
} from '../composables/useThreadSummaries'
import { resolveChatMessagesStatus, shouldAwaitAssistantOutput } from '../utils/chat-messages-status'
import {
  ITEM_PART,
  eventToMessage,
  isSubagentActiveStatus,
  itemToMessages,
  replaceStreamingMessage,
  threadToMessages,
  upsertStreamingMessage,
  type ChatMessage,
  type ChatPart,
  type FileChangeItem,
  type ItemData,
  type McpToolCallItem
} from '~~/shared/codex-chat'
import { buildTurnStartInput, type PersistedProjectAttachment } from '~~/shared/chat-attachments'
import {
  type ConfigReadResponse,
  type ModelListResponse,
  notificationThreadName,
  notificationThreadId,
  notificationThreadUpdatedAt,
  notificationTurnId,
  type CodexRpcNotification,
  type CodexThread,
  type CodexThreadItem,
  type ReviewStartParams,
  type ReviewStartResponse,
  type ReviewTarget,
  type ThreadReadResponse,
  type ThreadResumeResponse,
  type ThreadStartResponse,
  type TurnStartResponse
} from '~~/shared/codex-rpc'
import {
  buildTurnOverrides,
  coercePromptSelection,
  ensureModelOption,
  FALLBACK_MODELS,
  formatCompactTokenCount,
  formatReasoningEffortLabel,
  normalizeConfigDefaults,
  normalizeModelList,
  normalizeThreadTokenUsage,
  resolveContextWindowState,
  resolveEffortOptions,
  shouldShowContextWindowIndicator,
  visibleModelOptions,
  type ReasoningEffort
} from '~~/shared/chat-prompt-controls'
import {
  resolveProjectGitBranchesUrl,
  toProjectThreadRoute,
  type ProjectGitBranchesResponse
} from '~~/shared/codori'
import {
  filterSlashCommands,
  findActiveSlashCommand,
  parseSubmittedSlashCommand,
  SLASH_COMMANDS,
  toSlashCommandCompletion,
  type SlashCommandDefinition
} from '~~/shared/slash-commands'

const props = defineProps<{
  projectId: string
  threadId?: string | null
}>()

const router = useRouter()
const runtimeConfig = useRuntimeConfig()
const { getClient } = useRpc()
const {
  loaded,
  refreshProjects,
  getProject,
  startProject
} = useProjects()
const {
  onCompositionStart,
  onCompositionEnd,
  shouldSubmit
} = useChatSubmitGuard()
const {
  attachments,
  isDragging,
  isUploading,
  error: attachmentError,
  fileInput,
  removeAttachment,
  replaceAttachments,
  clearAttachments,
  discardSnapshot,
  openFilePicker,
  onFileInputChange,
  onPaste,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  uploadAttachments
} = useChatAttachments(props.projectId)
const input = ref('')
const chatPromptRef = ref<{
  textareaRef?: unknown
} | null>(null)
const slashDropdownRef = ref<HTMLElement | null>(null)
const scrollViewport = ref<HTMLElement | null>(null)
const pinnedToBottom = ref(true)
const session = useChatSession(props.projectId)
const { syncThreadSummary, updateThreadSummaryTitle } = useThreadSummaries(props.projectId)
const {
  messages,
  subagentPanels,
  status,
  error,
  activeThreadId,
  threadTitle,
  pendingThreadId,
  autoRedirectThreadId,
  loadVersion,
  promptControlsLoaded,
  promptControlsLoading,
  availableModels,
  selectedModel,
  selectedEffort,
  modelContextWindow,
  tokenUsage
} = session
const {
  pendingRequest,
  hasPendingRequest,
  handleServerRequest,
  resolveCurrentRequest,
  cancelAllPendingRequests
} = usePendingUserRequest(props.projectId, activeThreadId)

const selectedProject = computed(() => getProject(props.projectId))
const composerError = computed(() => attachmentError.value ?? error.value)
const submitError = computed(() => composerError.value ? new Error(composerError.value) : undefined)
const interruptRequested = ref(false)
const awaitingAssistantOutput = ref(false)
const sendMessageLocked = ref(false)
const reviewStartPending = ref(false)
const promptSelectionStart = ref(0)
const promptSelectionEnd = ref(0)
const isPromptFocused = ref(false)
const dismissedSlashMatchKey = ref<string | null>(null)
const slashHighlightIndex = ref(0)
const reviewDrawerOpen = ref(false)
const reviewDrawerMode = ref<'target' | 'branch'>('target')
const reviewDrawerCommandText = ref('/review')
const usageStatusModalOpen = ref(false)
const reviewBranches = ref<string[]>([])
const reviewCurrentBranch = ref<string | null>(null)
const reviewBranchesLoading = ref(false)
const reviewBranchesError = ref<string | null>(null)
const isBusy = computed(() =>
  status.value === 'submitted'
  || status.value === 'streaming'
  || isUploading.value
  || reviewStartPending.value
)
const hasDraftContent = computed(() =>
  input.value.trim().length > 0
  || attachments.value.length > 0
)
const isComposerDisabled = computed(() =>
  isUploading.value
  || interruptRequested.value
  || hasPendingRequest.value
  || reviewStartPending.value
)
const composerPlaceholder = computed(() =>
  hasPendingRequest.value
    ? 'Respond to the pending request below to let Codex continue'
    : 'Describe the change you want Codex to make'
)
const promptSubmitStatus = computed(() =>
  resolvePromptSubmitStatus({
    status: status.value,
    hasDraftContent: hasDraftContent.value
  })
)
const routeThreadId = computed(() => props.threadId ?? null)
const projectTitle = computed(() => selectedProject.value?.projectId ?? props.projectId)
const chatMessagesStatus = computed(() =>
  resolveChatMessagesStatus(status.value, awaitingAssistantOutput.value)
)
const showWelcomeState = computed(() =>
  !routeThreadId.value
  && !activeThreadId.value
  && messages.value.length === 0
  && !isBusy.value
)

const slashCommands = computed(() =>
  SLASH_COMMANDS.filter(() => !hasPendingRequest.value)
)

const activeSlashMatch = computed(() =>
  isPromptFocused.value
    ? findActiveSlashCommand(input.value, promptSelectionStart.value, promptSelectionEnd.value)
    : null
)

const activeSlashMatchKey = computed(() => {
  const match = activeSlashMatch.value
  if (!match) {
    return null
  }

  return `${match.start}:${match.end}:${match.raw}`
})

const filteredSlashCommands = computed(() =>
  activeSlashMatch.value
    ? filterSlashCommands(slashCommands.value, activeSlashMatch.value.query)
    : []
)

const slashDropdownOpen = computed(() =>
  !reviewDrawerOpen.value
  && Boolean(activeSlashMatch.value)
  && activeSlashMatchKey.value !== dismissedSlashMatchKey.value
  && filteredSlashCommands.value.length > 0
)

const highlightedSlashCommand = computed(() =>
  filteredSlashCommands.value[slashHighlightIndex.value] ?? filteredSlashCommands.value[0] ?? null
)

const reviewBaseBranches = computed(() =>
  reviewBranches.value.filter(branch => branch !== reviewCurrentBranch.value)
)

const starterPrompts = computed(() => {
  const project = projectTitle.value

  return [
    {
      title: 'Map the codebase',
      text: `Summarize the structure of ${project} and identify the main entry points.`
    },
    {
      title: 'Find the next task',
      text: `Inspect ${project} and suggest the highest-impact improvement to make next.`
    },
    {
      title: 'Build a plan',
      text: `Read ${project} and propose a concrete implementation plan for the next feature.`
    }
  ]
})

const effectiveModelList = computed(() => {
  const withSelected = ensureModelOption(
    availableModels.value.length > 0 ? availableModels.value : FALLBACK_MODELS,
    selectedModel.value,
    selectedEffort.value
  )
  return visibleModelOptions(withSelected)
})
const selectedModelOption = computed(() =>
  effectiveModelList.value.find(model => model.model === selectedModel.value)
  ?? effectiveModelList.value[0]
  ?? FALLBACK_MODELS[0]
)
const modelSelectItems = computed(() =>
  effectiveModelList.value.map(model => ({
    label: model.displayName,
    value: model.model
  }))
)
const effortOptions = computed(() => resolveEffortOptions(effectiveModelList.value, selectedModel.value))
const effortSelectItems = computed(() =>
  effortOptions.value.map(effort => ({
    label: formatReasoningEffortLabel(effort),
    value: effort
  }))
)
const contextWindowState = computed(() =>
  resolveContextWindowState(tokenUsage.value, modelContextWindow.value)
)
const showContextIndicator = computed(() => shouldShowContextWindowIndicator(contextWindowState.value))
const contextUsedPercent = computed(() => contextWindowState.value.usedPercent ?? 0)
const contextIndicatorLabel = computed(() => {
  const remainingPercent = contextWindowState.value.remainingPercent
  return remainingPercent == null ? 'ctx' : `${Math.round(remainingPercent)}%`
})

const normalizePromptSelection = (
  preferredModel?: string | null,
  preferredEffort?: ReasoningEffort | null
) => {
  const withSelected = ensureModelOption(
    availableModels.value.length > 0 ? availableModels.value : FALLBACK_MODELS,
    preferredModel ?? selectedModel.value,
    preferredEffort ?? selectedEffort.value
  )
  const visibleModels = visibleModelOptions(withSelected)
  const nextSelection = coercePromptSelection(visibleModels, preferredModel ?? selectedModel.value, preferredEffort ?? selectedEffort.value)

  availableModels.value = visibleModels
  if (selectedModel.value !== nextSelection.model) {
    selectedModel.value = nextSelection.model
  }
  if (selectedEffort.value !== nextSelection.effort) {
    selectedEffort.value = nextSelection.effort
  }
}

const syncPromptSelectionFromThread = (
  model: string | null | undefined,
  effort: ReasoningEffort | null | undefined
) => {
  normalizePromptSelection(model ?? null, effort ?? null)
}

const loadPromptControls = async () => {
  if (promptControlsLoaded.value) {
    return
  }

  if (promptControlsPromise) {
    return await promptControlsPromise
  }

  promptControlsPromise = (async () => {
    promptControlsLoading.value = true

    try {
      await ensureProjectRuntime()
      const client = getClient(props.projectId)
      const initialModel = selectedModel.value
      const initialEffort = selectedEffort.value
      let nextModels = availableModels.value.length > 0 ? availableModels.value : FALLBACK_MODELS
      let defaultModel: string | null = null
      let defaultEffort: ReasoningEffort | null = null

      const [modelsResponse, configResponse] = await Promise.allSettled([
        client.request<ModelListResponse>('model/list'),
        client.request<ConfigReadResponse>('config/read')
      ])

      if (modelsResponse.status === 'fulfilled') {
        nextModels = visibleModelOptions(normalizeModelList(modelsResponse.value))
      } else {
        nextModels = visibleModelOptions(nextModels)
      }

      if (configResponse.status === 'fulfilled') {
        const defaults = normalizeConfigDefaults(configResponse.value)
        if (defaults.contextWindow != null) {
          modelContextWindow.value = defaults.contextWindow
        }
        defaultModel = defaults.model
        defaultEffort = defaults.effort
      }

      availableModels.value = nextModels

      const preferredModel = selectedModel.value !== initialModel
        ? selectedModel.value
        : defaultModel ?? initialModel
      const preferredEffort = selectedEffort.value !== initialEffort
        ? selectedEffort.value
        : defaultEffort ?? initialEffort

      normalizePromptSelection(preferredModel, preferredEffort)
      promptControlsLoaded.value = true
    } finally {
      promptControlsLoading.value = false
      promptControlsPromise = null
    }
  })()

  return await promptControlsPromise
}

const subagentBootstrapPromises = new Map<string, Promise<void>>()
const optimisticAttachmentSnapshots = new Map<string, DraftAttachment[]>()
let promptControlsPromise: Promise<void> | null = null
let pendingThreadHydration: Promise<void> | null = null
let releaseServerRequestHandler: (() => void) | null = null

const isActiveTurnStatus = (value: string | null | undefined) => {
  if (!value) {
    return false
  }

  return !/(completed|failed|error|cancelled|canceled|interrupted|stopped)/i.test(value)
}

const currentLiveStream = () =>
  session.liveStream?.threadId === activeThreadId.value
    ? session.liveStream
    : null

const hasActiveTurnEngagement = () =>
  Boolean(currentLiveStream() || session.pendingLiveStream)

const shouldSubmitWithTurnSteer = () =>
  shouldSubmitViaTurnSteer({
    activeThreadId: activeThreadId.value,
    liveStreamThreadId: session.liveStream?.threadId ?? null,
    liveStreamTurnId: session.liveStream?.turnId ?? null,
    status: status.value
  })

const rejectLiveStreamTurnWaiters = (liveStream: LiveStream, error: Error) => {
  const waiters = liveStream.turnIdWaiters.splice(0, liveStream.turnIdWaiters.length)
  for (const waiter of waiters) {
    waiter.reject(error)
  }
}

const createLiveStreamState = (
  threadId: string,
  bufferedNotifications: CodexRpcNotification[] = []
): LiveStream => ({
  threadId,
  turnId: null,
  lockedTurnId: null,
  bufferedNotifications,
  observedSubagentThreadIds: new Set<string>(),
  pendingUserMessageIds: [],
  turnIdWaiters: [],
  interruptRequested: false,
  interruptAcknowledged: false,
  unsubscribe: null
})

const setSessionLiveStream = (liveStream: LiveStream | null) => {
  session.liveStream = liveStream
  interruptRequested.value = liveStream?.interruptRequested === true
}

const setLiveStreamInterruptRequested = (liveStream: LiveStream, nextValue: boolean) => {
  liveStream.interruptRequested = nextValue

  if (session.liveStream === liveStream) {
    interruptRequested.value = nextValue
  }
}

const setLiveStreamTurnId = (liveStream: LiveStream, turnId: string | null) => {
  liveStream.turnId = turnId

  if (!turnId) {
    liveStream.lockedTurnId = null
    return
  }

  liveStream.interruptAcknowledged = false
  const waiters = liveStream.turnIdWaiters.splice(0, liveStream.turnIdWaiters.length)
  for (const waiter of waiters) {
    waiter.resolve(turnId)
  }
}

const lockLiveStreamTurnId = (liveStream: LiveStream, turnId: string | null) => {
  liveStream.lockedTurnId = turnId
  setLiveStreamTurnId(liveStream, turnId)
}

const waitForLiveStreamTurnId = async (liveStream: LiveStream) => {
  if (liveStream.turnId) {
    return liveStream.turnId
  }

  return await new Promise<string>((resolve, reject) => {
    liveStream.turnIdWaiters.push({ resolve, reject })
  })
}

const queuePendingUserMessage = (liveStream: LiveStream, messageId: string) => {
  if (liveStream.pendingUserMessageIds.includes(messageId)) {
    return
  }

  liveStream.pendingUserMessageIds.push(messageId)
}

const replayBufferedNotifications = (liveStream: LiveStream) => {
  const trackedTurnId = liveStream.lockedTurnId ?? liveStream.turnId
  for (const notification of liveStream.bufferedNotifications.splice(0, liveStream.bufferedNotifications.length)) {
    const turnId = notificationTurnId(notification)
    if (turnId && trackedTurnId && turnId !== trackedTurnId) {
      continue
    }

    applyNotification(notification)
  }
}

const clearLiveStream = (reason?: Error) => {
  const liveStream = session.liveStream
  if (!liveStream) {
    interruptRequested.value = false
    return null
  }

  liveStream.unsubscribe?.()
  rejectLiveStreamTurnWaiters(liveStream, reason ?? new Error('The active turn is no longer available.'))
  setSessionLiveStream(null)
  return liveStream
}

const ensurePendingLiveStream = async () => {
  const existingLiveStream = currentLiveStream()
  if (existingLiveStream) {
    return existingLiveStream
  }

  if (session.pendingLiveStream) {
    return await session.pendingLiveStream
  }

  const pendingLiveStream = (async () => {
    await ensureProjectRuntime()
    const { threadId, created } = await ensureThread()
    const client = getClient(props.projectId)
    const buffered: CodexRpcNotification[] = []
    clearLiveStream()

    const liveStream = createLiveStreamState(threadId, buffered)
    liveStream.unsubscribe = client.subscribe((notification) => {
      const targetThreadId = notificationThreadId(notification)
      if (!targetThreadId) {
        return
      }

      if (targetThreadId !== threadId) {
        if (liveStream.observedSubagentThreadIds.has(targetThreadId)) {
          applySubagentNotification(targetThreadId, notification)
        }
        return
      }

      if (!liveStream.turnId) {
        buffered.push(notification)
        return
      }

      const turnId = notificationTurnId(notification)
      if (!shouldApplyNotificationToCurrentTurn({
        liveStreamTurnId: liveStream.turnId,
        lockedTurnId: liveStream.lockedTurnId,
        notificationMethod: notification.method,
        notificationTurnId: turnId
      })) {
        return
      }

      applyNotification(notification)
    })

    setSessionLiveStream(liveStream)

    if (created && !routeThreadId.value) {
      pendingThreadId.value = threadId
    }

    return liveStream
  })()

  session.pendingLiveStream = pendingLiveStream

  try {
    return await pendingLiveStream
  } finally {
    if (session.pendingLiveStream === pendingLiveStream) {
      session.pendingLiveStream = null
    }
  }
}

const createOptimisticMessageId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `local-user-${crypto.randomUUID()}`
    : `local-user-${Date.now()}-${Math.random().toString(16).slice(2)}`

const buildOptimisticMessage = (text: string, submittedAttachments: DraftAttachment[]): ChatMessage => ({
  id: createOptimisticMessageId(),
  role: 'user',
  parts: [
    ...(text.trim()
      ? [{
          type: 'text' as const,
          text,
          state: 'done' as const
        }]
      : []),
    ...submittedAttachments.map((attachment) => ({
      type: 'attachment' as const,
      attachment: {
        kind: 'image' as const,
        name: attachment.name,
        mediaType: attachment.mediaType,
        url: attachment.previewUrl
      }
    }))
  ]
})

const rememberOptimisticAttachments = (messageId: string, submittedAttachments: DraftAttachment[]) => {
  if (submittedAttachments.length === 0) {
    return
  }

  optimisticAttachmentSnapshots.set(messageId, submittedAttachments)
}

const formatAttachmentSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  if (size >= 1024) {
    return `${Math.round(size / 1024)} KB`
  }

  return `${size} B`
}

const isTextareaElement = (value: unknown): value is HTMLTextAreaElement =>
  typeof HTMLTextAreaElement !== 'undefined'
  && value instanceof HTMLTextAreaElement

const getPromptTextarea = () => {
  const exposed = chatPromptRef.value?.textareaRef
  if (isTextareaElement(exposed)) {
    return exposed
  }

  if (
    typeof exposed === 'object'
    && exposed !== null
    && 'value' in exposed
    && isTextareaElement(exposed.value)
  ) {
    return exposed.value
  }

  return null
}

const syncPromptSelectionFromDom = () => {
  const textarea = getPromptTextarea()
  promptSelectionStart.value = textarea?.selectionStart ?? input.value.length
  promptSelectionEnd.value = textarea?.selectionEnd ?? input.value.length

  if (!activeSlashMatchKey.value || activeSlashMatchKey.value !== dismissedSlashMatchKey.value) {
    dismissedSlashMatchKey.value = null
  }
}

const focusPromptAt = async (position?: number) => {
  await nextTick()
  const textarea = getPromptTextarea()
  if (!textarea) {
    return
  }

  const nextPosition = position ?? textarea.value.length
  textarea.focus()
  textarea.setSelectionRange(nextPosition, nextPosition)
  promptSelectionStart.value = nextPosition
  promptSelectionEnd.value = nextPosition
  isPromptFocused.value = true
}

const shouldRetainPromptFocus = (nextFocused: EventTarget | null | undefined) =>
  isFocusWithinContainer(nextFocused, slashDropdownRef.value)

const handlePromptBlur = (event: FocusEvent) => {
  // Slash suggestions must stay focusless. If focus ever moves into the popup,
  // the composer stops matching slash commands and the menu collapses while the
  // textarea still contains `/`. Keep this blur guard aligned with the inert
  // popup template below.
  if (shouldRetainPromptFocus(event.relatedTarget)) {
    void focusPromptAt(promptSelectionStart.value)
    return
  }

  isPromptFocused.value = false
}

const handleSlashDropdownPointerDown = (event: PointerEvent) => {
  // Fundamental rule for slash commands: the popup is only a visual chooser.
  // Selection happens through the textarea's keyboard handlers, and mouse/touch
  // clicks must not transfer DOM focus into popup items.
  event.preventDefault()
  void focusPromptAt(promptSelectionStart.value)
}

const setComposerError = (messageText: string) => {
  markAwaitingAssistantOutput(false)
  error.value = messageText
  status.value = 'error'
}

const resetReviewDrawerState = () => {
  reviewDrawerMode.value = 'target'
  reviewDrawerCommandText.value = '/review'
  reviewBranchesLoading.value = false
  reviewBranchesError.value = null
}

const closeReviewDrawer = () => {
  reviewDrawerOpen.value = false
  resetReviewDrawerState()
}

const openReviewDrawer = (commandText = '/review') => {
  dismissedSlashMatchKey.value = null
  reviewDrawerCommandText.value = commandText
  reviewDrawerMode.value = 'target'
  reviewBranchesError.value = null
  reviewDrawerOpen.value = true
}

const clearSlashCommandDraft = () => {
  // Successful slash commands consume the draft immediately. Leaving `/usage`
  // or `/review` in the prompt after opening the modal/drawer makes the next
  // edit start from stale command text and feels like the action did not finish.
  input.value = ''
  clearAttachments({ revoke: false })
  dismissedSlashMatchKey.value = null
}

const moveSlashHighlight = (delta: number) => {
  if (!filteredSlashCommands.value.length) {
    slashHighlightIndex.value = 0
    return
  }

  const maxIndex = filteredSlashCommands.value.length - 1
  const nextIndex = slashHighlightIndex.value + delta
  if (nextIndex < 0) {
    slashHighlightIndex.value = maxIndex
    return
  }

  if (nextIndex > maxIndex) {
    slashHighlightIndex.value = 0
    return
  }

  slashHighlightIndex.value = nextIndex
}

const resolveSlashCommandIcon = (command: SlashCommandDefinition) => {
  if (command.name === 'review') {
    return 'i-lucide-search-check'
  }

  if (command.name === 'usage' || command.name === 'status') {
    return 'i-lucide-gauge'
  }

  return 'i-lucide-terminal'
}

const completeSlashCommand = async (command: SlashCommandDefinition) => {
  const match = activeSlashMatch.value
  if (!match) {
    return
  }

  dismissedSlashMatchKey.value = null
  const completion = toSlashCommandCompletion(command)
  input.value = `${input.value.slice(0, match.start)}${completion}${input.value.slice(match.end)}`
  await focusPromptAt(match.start + completion.length)
}

const fetchProjectGitBranches = async () => {
  reviewBranchesLoading.value = true
  reviewBranchesError.value = null

  try {
    const response = await fetch(resolveProjectGitBranchesUrl({
      projectId: props.projectId,
      configuredBase: String(runtimeConfig.public.serverBase ?? '')
    }))

    const body = await response.json() as ProjectGitBranchesResponse | { error?: { message?: string } }
    if (!response.ok) {
      throw new Error(body && typeof body === 'object' && 'error' in body
        ? body.error?.message ?? 'Failed to load local branches.'
        : 'Failed to load local branches.')
    }

    const result = body as ProjectGitBranchesResponse
    reviewCurrentBranch.value = result.currentBranch
    reviewBranches.value = result.branches
  } finally {
    reviewBranchesLoading.value = false
  }
}

const openBaseBranchPicker = async () => {
  reviewDrawerMode.value = 'branch'

  try {
    await fetchProjectGitBranches()
    if (!reviewBaseBranches.value.length) {
      reviewBranchesError.value = 'No local base branches are available to compare against.'
    }
  } catch (caughtError) {
    reviewBranchesError.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
  }
}

const startReview = async (target: ReviewTarget) => {
  if (reviewStartPending.value) {
    return
  }

  if (hasPendingRequest.value || isBusy.value) {
    setComposerError('Review can only start when the current thread is idle.')
    return
  }

  reviewStartPending.value = true
  const draftText = reviewDrawerCommandText.value
  const submittedAttachments = attachments.value.slice()
  input.value = ''
  clearAttachments({ revoke: false })

  try {
    const client = getClient(props.projectId)
    const liveStream = await ensurePendingLiveStream()
    error.value = null
    status.value = 'submitted'
    tokenUsage.value = null
    markAwaitingAssistantOutput(true)

    const response = await client.request<ReviewStartResponse>('review/start', {
      threadId: liveStream.threadId,
      delivery: 'inline',
      target
    } satisfies ReviewStartParams)

    for (const item of response.turn.items) {
      if (item.type === 'userMessage') {
        continue
      }

      for (const nextMessage of itemToMessages(item)) {
        messages.value = upsertStreamingMessage(messages.value, {
          ...nextMessage,
          pending: false
        })
      }
    }

    lockLiveStreamTurnId(liveStream, response.turn.id)
    replayBufferedNotifications(liveStream)
    closeReviewDrawer()
  } catch (caughtError) {
    restoreDraftIfPristine(draftText, submittedAttachments)
    setComposerError(caughtError instanceof Error ? caughtError.message : String(caughtError))
  } finally {
    reviewStartPending.value = false
  }
}

const handleSlashCommandSubmission = async (
  rawText: string,
  submittedAttachments: DraftAttachment[]
) => {
  const slashCommand = parseSubmittedSlashCommand(rawText)
  if (!slashCommand) {
    return false
  }

  const command = slashCommands.value.find(candidate => candidate.name === slashCommand.name)
  if (!command) {
    return false
  }

  if (submittedAttachments.length > 0) {
    setComposerError('Slash commands do not support image attachments yet.')
    return true
  }

  switch (command.name) {
    case 'review': {
      if (!slashCommand.isBare) {
        setComposerError('`/review` currently only supports the bare command. Choose the diff target in the review drawer.')
        return true
      }

      error.value = null
      status.value = 'ready'
      clearSlashCommandDraft()
      openReviewDrawer(rawText.trim())
      await focusPromptAt(0)
      return true
    }
    case 'usage':
    case 'status': {
      if (!slashCommand.isBare) {
        setComposerError(`\`/${command.name}\` currently only supports the bare command.`)
        return true
      }

      error.value = null
      status.value = 'ready'
      clearSlashCommandDraft()
      usageStatusModalOpen.value = true
      return true
    }
    default:
      return false
  }
}

const activateSlashCommand = async (
  command: SlashCommandDefinition,
  mode: 'complete' | 'execute'
) => {
  if (mode === 'complete') {
    await completeSlashCommand(command)
    return
  }

  await handleSlashCommandSubmission(`/${command.name}`, attachments.value.slice())
}

const handleReviewDrawerOpenChange = (open: boolean) => {
  if (open) {
    reviewDrawerOpen.value = true
    return
  }

  closeReviewDrawer()
}

const handleUsageStatusOpenChange = (open: boolean) => {
  usageStatusModalOpen.value = open
}

const handleReviewDrawerBack = () => {
  reviewDrawerMode.value = 'target'
  reviewBranchesError.value = null
}

const removeOptimisticMessage = (messageId: string) => {
  messages.value = removeChatMessage(messages.value, messageId)
  optimisticAttachmentSnapshots.delete(messageId)
}

const markAwaitingAssistantOutput = (nextValue: boolean) => {
  awaitingAssistantOutput.value = nextValue
}

const markAssistantOutputStartedForItem = (item: CodexThreadItem) => {
  if (item.type !== 'userMessage') {
    markAwaitingAssistantOutput(false)
  }
}

const restoreDraftIfPristine = (text: string, submittedAttachments: DraftAttachment[]) => {
  if (!input.value.trim()) {
    input.value = text
  }

  if (attachments.value.length === 0 && submittedAttachments.length > 0) {
    replaceAttachments(submittedAttachments)
  }
}

const untrackPendingUserMessage = (messageId: string) => {
  const liveStream = currentLiveStream()
  if (!liveStream) {
    return
  }

  liveStream.pendingUserMessageIds = removePendingUserMessageId(liveStream.pendingUserMessageIds, messageId)
}

const reconcilePendingUserMessage = (confirmedMessage: ChatMessage) => {
  const liveStream = currentLiveStream()
  const optimisticMessageId = liveStream?.pendingUserMessageIds.shift() ?? null
  if (!optimisticMessageId) {
    messages.value = upsertStreamingMessage(messages.value, confirmedMessage)
    return
  }

  const pendingAttachments = optimisticAttachmentSnapshots.get(optimisticMessageId)
  if (pendingAttachments) {
    discardSnapshot(pendingAttachments)
    optimisticAttachmentSnapshots.delete(optimisticMessageId)
  }

  messages.value = reconcileOptimisticUserMessage(messages.value, optimisticMessageId, confirmedMessage)
}

const clearPendingOptimisticMessages = (liveStream: LiveStream | null, options?: { discardSnapshots?: boolean }) => {
  if (!liveStream) {
    return
  }

  for (const messageId of liveStream.pendingUserMessageIds) {
    messages.value = removeChatMessage(messages.value, messageId)
    const pendingAttachments = optimisticAttachmentSnapshots.get(messageId)
    if (options?.discardSnapshots && pendingAttachments) {
      discardSnapshot(pendingAttachments)
    }
    optimisticAttachmentSnapshots.delete(messageId)
  }

  liveStream.pendingUserMessageIds = []
}

const submitTurnStart = async (input: {
  client: ReturnType<typeof getClient>
  liveStream: LiveStream
  text: string
  submittedAttachments: DraftAttachment[]
  uploadedAttachments?: PersistedProjectAttachment[]
  optimisticMessageId: string
  queueOptimisticMessage?: boolean
}) => {
  const {
    client,
    liveStream,
    text,
    submittedAttachments,
    uploadedAttachments: existingUploadedAttachments,
    optimisticMessageId,
    queueOptimisticMessage: shouldQueueOptimisticMessage = true
  } = input

  if (shouldQueueOptimisticMessage) {
    queuePendingUserMessage(liveStream, optimisticMessageId)
  }

  const uploadedAttachments = existingUploadedAttachments
    ?? await uploadAttachments(liveStream.threadId, submittedAttachments)
  const turnStart = await client.request<TurnStartResponse>('turn/start', {
    threadId: liveStream.threadId,
    input: buildTurnStartInput(text, uploadedAttachments),
    cwd: selectedProject.value?.projectPath ?? null,
    approvalPolicy: 'never',
    ...buildTurnOverrides(selectedModel.value, selectedEffort.value)
  })

  tokenUsage.value = null
  setLiveStreamTurnId(liveStream, turnStart.turn.id)
  replayBufferedNotifications(liveStream)
}

const shortThreadId = (value: string) => value.slice(0, 8)

const resolveSubagentName = (
  threadId: string,
  thread?: Pick<CodexThread, 'agentNickname' | 'name' | 'preview'> | null
) => {
  const candidate = thread?.agentNickname?.trim()
    || thread?.name?.trim()
    || thread?.preview?.trim()

  if (candidate) {
    return candidate
  }

  return `Agent ${shortThreadId(threadId)}`
}

const getSubagentPanel = (threadId: string) =>
  subagentPanels.value.find(panel => panel.threadId === threadId)

const createSubagentPanelState = (threadId: string): SubagentPanelState => ({
  threadId,
  name: resolveSubagentName(threadId),
  status: null,
  messages: [],
  firstSeenAt: Date.now(),
  lastSeenAt: Date.now(),
  turnId: null,
  bootstrapped: false,
  bufferedNotifications: []
})

const upsertSubagentPanel = (
  threadId: string,
  updater: (panel: SubagentPanelState | undefined) => SubagentPanelState
) => {
  const current = getSubagentPanel(threadId)
  const nextPanel = updater(current)
  const index = subagentPanels.value.findIndex(panel => panel.threadId === threadId)

  if (index === -1) {
    subagentPanels.value = [...subagentPanels.value, nextPanel]
    return nextPanel
  }

  subagentPanels.value = subagentPanels.value.map((panel, panelIndex) =>
    panelIndex === index ? nextPanel : panel
  )
  return nextPanel
}

const rememberObservedSubagentThread = (threadId: string) => {
  session.liveStream?.observedSubagentThreadIds.add(threadId)
}

const isTextPart = (part: ChatPart): part is Extract<ChatPart, { type: 'text' }> =>
  part.type === 'text'

const isItemPart = (part: ChatPart): part is Extract<ChatPart, { type: typeof ITEM_PART }> =>
  part.type === ITEM_PART

const getFallbackItemData = (message: ChatMessage) => {
  const itemPart = message.parts.find(isItemPart)
  if (!itemPart) {
    throw new Error('Expected fallback item part.')
  }

  return itemPart.data
}

const updatePinnedState = () => {
  const viewport = scrollViewport.value
  if (!viewport) {
    return
  }

  pinnedToBottom.value = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
}

const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
  const viewport = scrollViewport.value
  if (!viewport) {
    return
  }

  viewport.scrollTo({
    top: viewport.scrollHeight,
    behavior
  })
}

const scheduleScrollToBottom = async (behavior: ScrollBehavior = 'auto') => {
  await nextTick()

  if (!import.meta.client) {
    scrollToBottom(behavior)
    return
  }

  requestAnimationFrame(() => {
    if (pinnedToBottom.value || isBusy.value) {
      scrollToBottom(behavior)
    }
  })
}

const ensureProjectRuntime = async () => {
  if (!loaded.value) {
    await refreshProjects()
  }

  if (selectedProject.value?.status === 'running') {
    return
  }

  await startProject(props.projectId)
}

const hydrateThread = async (threadId: string) => {
  const hydratePromise = (async () => {
    const requestVersion = loadVersion.value + 1
    loadVersion.value = requestVersion
    error.value = null
    tokenUsage.value = null

    try {
      await ensureProjectRuntime()
      const client = getClient(props.projectId)
      activeThreadId.value = threadId

      const existingLiveStream = session.liveStream

      if (existingLiveStream && existingLiveStream.threadId !== threadId) {
        clearLiveStream()
      }

      if (!session.liveStream) {
        const nextLiveStream = createLiveStreamState(threadId)

        nextLiveStream.unsubscribe = client.subscribe((notification) => {
          const targetThreadId = notificationThreadId(notification)
          if (!targetThreadId) {
            return
          }

          if (targetThreadId !== threadId) {
            if (nextLiveStream.observedSubagentThreadIds.has(targetThreadId)) {
              applySubagentNotification(targetThreadId, notification)
            }
            return
          }

          if (!nextLiveStream.turnId) {
            nextLiveStream.bufferedNotifications.push(notification)
            return
          }

          const turnId = notificationTurnId(notification)
          if (!shouldApplyNotificationToCurrentTurn({
            liveStreamTurnId: nextLiveStream.turnId,
            lockedTurnId: nextLiveStream.lockedTurnId,
            notificationMethod: notification.method,
            notificationTurnId: turnId
          })) {
            return
          }

          applyNotification(notification)
        })

        setSessionLiveStream(nextLiveStream)
      }

      const resumeResponse = await client.request<ThreadResumeResponse>('thread/resume', {
        threadId,
        cwd: selectedProject.value?.projectPath ?? null,
        approvalPolicy: 'never',
        persistExtendedHistory: true
      })
      const response = await client.request<ThreadReadResponse>('thread/read', {
        threadId,
        includeTurns: true
      })

      if (loadVersion.value !== requestVersion) {
        return
      }

      syncPromptSelectionFromThread(
        resumeResponse.model ?? null,
        (resumeResponse.reasoningEffort as ReasoningEffort | null | undefined) ?? null
      )
      activeThreadId.value = response.thread.id
      threadTitle.value = resolveThreadSummaryTitle(response.thread)
      syncThreadSummary(response.thread)
      messages.value = threadToMessages(response.thread)
      rebuildSubagentPanelsFromThread(response.thread)
      markAwaitingAssistantOutput(false)
      const activeTurn = [...response.thread.turns].reverse().find(turn => isActiveTurnStatus(turn.status))

      if (!activeTurn) {
        clearLiveStream()
        status.value = 'ready'
        return
      }

      if (!session.liveStream) {
        status.value = 'streaming'
        return
      }

      setLiveStreamTurnId(session.liveStream, activeTurn.id)
      status.value = 'streaming'

      const pendingNotifications = session.liveStream.bufferedNotifications.splice(0, session.liveStream.bufferedNotifications.length)
      for (const notification of pendingNotifications) {
        const turnId = notificationTurnId(notification)
        if (turnId && turnId !== activeTurn.id) {
          continue
        }

        applyNotification(notification)
      }
    } catch (caughtError) {
      clearLiveStream()
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
      status.value = 'error'
    }
  })()

  pendingThreadHydration = hydratePromise

  try {
    await hydratePromise
  } finally {
    if (pendingThreadHydration === hydratePromise) {
      pendingThreadHydration = null
    }
  }
}

const resetDraftThread = () => {
  clearLiveStream()
  session.pendingLiveStream = null
  activeThreadId.value = null
  threadTitle.value = null
  pendingThreadId.value = null
  autoRedirectThreadId.value = null
  messages.value = []
  subagentPanels.value = []
  error.value = null
  tokenUsage.value = null
  markAwaitingAssistantOutput(false)
  status.value = 'ready'
}

const ensureThread = async () => {
  if (activeThreadId.value) {
    return {
      threadId: activeThreadId.value,
      created: false
    }
  }

  await ensureProjectRuntime()
  const client = getClient(props.projectId)
  const response = await client.request<ThreadStartResponse>('thread/start', {
    cwd: selectedProject.value?.projectPath ?? null,
    approvalPolicy: 'never',
    experimentalRawEvents: false,
    persistExtendedHistory: true
  })

  activeThreadId.value = response.thread.id
  threadTitle.value = resolveThreadSummaryTitle(response.thread)
  syncThreadSummary(response.thread)
  return {
    threadId: response.thread.id,
    created: true
  }
}

const seedStreamingMessage = (item: CodexThreadItem) => {
  const [seed] = itemToMessages(item)
  if (!seed) {
    return
  }

  messages.value = upsertStreamingMessage(messages.value, {
    ...seed,
    pending: true
  })
}

const updateMessage = (
  messageId: string,
  fallbackMessage: ChatMessage,
  transform: (message: ChatMessage) => ChatMessage
) => {
  const existing = messages.value.find(message => message.id === messageId)
  messages.value = upsertStreamingMessage(messages.value, transform(existing ?? fallbackMessage))
}

const appendTextPartDelta = (
  messageId: string,
  delta: string,
  fallbackMessage: ChatMessage
) => {
  updateMessage(messageId, fallbackMessage, (message) => {
    const partIndex = message.parts.findIndex(isTextPart)
    const existingTextPart = partIndex === -1 ? null : message.parts[partIndex] as Extract<ChatPart, { type: 'text' }>
    const nextText = existingTextPart ? `${existingTextPart.text}${delta}` : delta
    const nextTextPart: Extract<ChatPart, { type: 'text' }> = {
      type: 'text',
      text: nextText,
      state: 'streaming'
    }
    const nextParts = partIndex === -1
      ? [...message.parts, nextTextPart]
      : message.parts.map((part, index) => index === partIndex ? nextTextPart : part)

    return {
      ...message,
      pending: true,
      parts: nextParts
    }
  })
}

const updateItemPart = (
  messageId: string,
  fallbackMessage: ChatMessage,
  transform: (itemData: ItemData) => ItemData
) => {
  updateMessage(messageId, fallbackMessage, (message) => {
    const partIndex = message.parts.findIndex(isItemPart)
    const existingData = partIndex === -1 ? null : (message.parts[partIndex] as Extract<ChatPart, { type: typeof ITEM_PART }>).data
    const nextData = transform(existingData ?? getFallbackItemData(fallbackMessage))
    const nextPart: Extract<ChatPart, { type: typeof ITEM_PART }> = {
      type: ITEM_PART,
      data: nextData
    }
    const nextParts = partIndex === -1
      ? [...message.parts, nextPart]
      : message.parts.map((part, index) => index === partIndex ? nextPart : part)

    return {
      ...message,
      pending: true,
      parts: nextParts
    }
  })
}

const fallbackCommandMessage = (itemId: string): ChatMessage => ({
  id: itemId,
  role: 'system',
  pending: true,
  parts: [{
    type: ITEM_PART,
    data: {
      kind: 'command_execution',
      item: {
        type: 'commandExecution',
        id: itemId,
        command: 'Command',
        aggregatedOutput: '',
        exitCode: null,
        status: 'inProgress'
      }
    }
  }]
})

const fallbackFileChangeMessage = (itemId: string): ChatMessage => ({
  id: itemId,
  role: 'system',
  pending: true,
  parts: [{
    type: ITEM_PART,
    data: {
      kind: 'file_change',
      item: {
        type: 'fileChange',
        id: itemId,
        changes: [],
        status: 'inProgress',
        liveOutput: ''
      }
    }
  }]
})

const fallbackMcpToolMessage = (itemId: string): ChatMessage => ({
  id: itemId,
  role: 'system',
  pending: true,
  parts: [{
    type: ITEM_PART,
    data: {
      kind: 'mcp_tool_call',
      item: {
        type: 'mcpToolCall',
        id: itemId,
        server: 'mcp',
        tool: 'tool',
        arguments: null,
        result: null,
        error: null,
        status: 'inProgress',
        progressMessages: []
      }
    }
  }]
})

const fallbackCommandItemData = (itemId: string) =>
  getFallbackItemData(fallbackCommandMessage(itemId)) as Extract<ItemData, { kind: 'command_execution' }>

const fallbackFileChangeItemData = (itemId: string) =>
  getFallbackItemData(fallbackFileChangeMessage(itemId)) as Extract<ItemData, { kind: 'file_change' }>

const fallbackMcpToolItemData = (itemId: string) =>
  getFallbackItemData(fallbackMcpToolMessage(itemId)) as Extract<ItemData, { kind: 'mcp_tool_call' }>

const pushEventMessage = (kind: 'turn.failed' | 'stream.error', messageText: string) => {
  messages.value = upsertStreamingMessage(
    messages.value,
    eventToMessage(`event-${kind}-${Date.now()}`, kind === 'turn.failed'
      ? {
          kind,
          error: {
            message: messageText
          }
        }
      : {
          kind,
          message: messageText
        })
  )
}

const updateSubagentPanelMessages = (
  threadId: string,
  updater: (panelMessages: ChatMessage[]) => ChatMessage[]
) => {
  upsertSubagentPanel(threadId, (panel) => {
    const basePanel = panel ?? createSubagentPanelState(threadId)
    return {
      ...basePanel,
      messages: updater(basePanel.messages),
      lastSeenAt: Date.now()
    }
  })
}

const updateSubagentMessage = (
  threadId: string,
  messageId: string,
  fallbackMessage: ChatMessage,
  transform: (message: ChatMessage) => ChatMessage
) => {
  updateSubagentPanelMessages(threadId, (panelMessages) => {
    const existing = panelMessages.find(message => message.id === messageId)
    return upsertStreamingMessage(panelMessages, transform(existing ?? fallbackMessage))
  })
}

const appendSubagentTextPartDelta = (
  threadId: string,
  messageId: string,
  delta: string,
  fallbackMessage: ChatMessage
) => {
  updateSubagentMessage(threadId, messageId, fallbackMessage, (message) => {
    const partIndex = message.parts.findIndex(isTextPart)
    const existingTextPart = partIndex === -1 ? null : message.parts[partIndex] as Extract<ChatPart, { type: 'text' }>
    const nextText = existingTextPart ? `${existingTextPart.text}${delta}` : delta
    const nextTextPart: Extract<ChatPart, { type: 'text' }> = {
      type: 'text',
      text: nextText,
      state: 'streaming'
    }
    const nextParts = partIndex === -1
      ? [...message.parts, nextTextPart]
      : message.parts.map((part, index) => index === partIndex ? nextTextPart : part)

    return {
      ...message,
      pending: true,
      parts: nextParts
    }
  })
}

const updateSubagentItemPart = (
  threadId: string,
  messageId: string,
  fallbackMessage: ChatMessage,
  transform: (itemData: ItemData) => ItemData
) => {
  updateSubagentMessage(threadId, messageId, fallbackMessage, (message) => {
    const partIndex = message.parts.findIndex(isItemPart)
    const existingData = partIndex === -1 ? null : (message.parts[partIndex] as Extract<ChatPart, { type: typeof ITEM_PART }>).data
    const nextData = transform(existingData ?? getFallbackItemData(fallbackMessage))
    const nextPart: Extract<ChatPart, { type: typeof ITEM_PART }> = {
      type: ITEM_PART,
      data: nextData
    }
    const nextParts = partIndex === -1
      ? [...message.parts, nextPart]
      : message.parts.map((part, index) => index === partIndex ? nextPart : part)

    return {
      ...message,
      pending: true,
      parts: nextParts
    }
  })
}

const pushSubagentEventMessage = (threadId: string, kind: 'turn.failed' | 'stream.error', messageText: string) => {
  updateSubagentPanelMessages(threadId, (panelMessages) =>
    upsertStreamingMessage(
      panelMessages,
      eventToMessage(`subagent-event-${threadId}-${kind}-${Date.now()}`, kind === 'turn.failed'
        ? {
            kind,
            error: {
              message: messageText
            }
          }
        : {
            kind,
            message: messageText
          })
    )
  )
}

const seedSubagentStreamingMessage = (threadId: string, item: CodexThreadItem) => {
  const [seed] = itemToMessages(item)
  if (!seed) {
    return
  }

  updateSubagentPanelMessages(threadId, (panelMessages) =>
    upsertStreamingMessage(panelMessages, {
      ...seed,
      pending: true
    })
  )
}

const bootstrapSubagentPanel = async (threadId: string) => {
  if (!threadId) {
    return
  }

  const existingPromise = subagentBootstrapPromises.get(threadId)
  if (existingPromise) {
    await existingPromise
    return
  }

  const bootstrapPromise = (async () => {
    try {
      await ensureProjectRuntime()
      const client = getClient(props.projectId)
      const response = await client.request<ThreadReadResponse>('thread/read', {
        threadId,
        includeTurns: true
      })
      const activeTurn = [...response.thread.turns].reverse().find(turn => isActiveTurnStatus(turn.status))
      const pendingNotifications = getSubagentPanel(threadId)?.bufferedNotifications.slice() ?? []

      upsertSubagentPanel(threadId, (panel) => {
        const basePanel = panel ?? createSubagentPanelState(threadId)
        return {
          ...basePanel,
          name: resolveSubagentName(threadId, response.thread),
          messages: threadToMessages(response.thread),
          turnId: activeTurn?.id ?? null,
          bootstrapped: true,
          bufferedNotifications: [],
          status: panel?.status
            ?? (activeTurn ? 'running' : basePanel.status)
            ?? null,
          lastSeenAt: Date.now()
        }
      })

      for (const notification of pendingNotifications) {
        applySubagentNotification(threadId, notification)
      }
    } catch {
      upsertSubagentPanel(threadId, (panel) => ({
        ...(panel ?? createSubagentPanelState(threadId)),
        lastSeenAt: Date.now()
      }))
    } finally {
      subagentBootstrapPromises.delete(threadId)
    }
  })()

  subagentBootstrapPromises.set(threadId, bootstrapPromise)
  await bootstrapPromise
}

const applySubagentActivityItem = (item: Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>) => {
  const orderedThreadIds = [
    ...item.receiverThreadIds,
    ...Object.keys(item.agentsStates).filter(threadId => !item.receiverThreadIds.includes(threadId))
  ]

  for (const threadId of orderedThreadIds) {
    const agentState = item.agentsStates[threadId]
    rememberObservedSubagentThread(threadId)
    upsertSubagentPanel(threadId, (panel) => {
      const basePanel = panel ?? createSubagentPanelState(threadId)
      return {
        ...basePanel,
        status: agentState?.status ?? basePanel.status,
        lastSeenAt: Date.now()
      }
    })
  }

  for (const threadId of orderedThreadIds) {
    void bootstrapSubagentPanel(threadId)
  }
}

const rebuildSubagentPanelsFromThread = (thread: CodexThread) => {
  subagentPanels.value = []
  for (const turn of thread.turns) {
    for (const item of turn.items) {
      if (item.type === 'collabAgentToolCall') {
        applySubagentActivityItem(item)
      }
    }
  }
}

const applySubagentNotification = (threadId: string, notification: CodexRpcNotification) => {
  const panel = getSubagentPanel(threadId)
  if (!panel) {
    return
  }

  if (!panel.bootstrapped) {
    upsertSubagentPanel(threadId, (existingPanel) => ({
      ...(existingPanel ?? createSubagentPanelState(threadId)),
      bufferedNotifications: [...(existingPanel?.bufferedNotifications ?? []), notification],
      lastSeenAt: Date.now()
    }))
    return
  }

  const turnId = notificationTurnId(notification)
  if (panel.turnId && turnId && turnId !== panel.turnId && notification.method !== 'turn/started') {
    return
  }

  switch (notification.method) {
    case 'turn/started': {
      upsertSubagentPanel(threadId, (existingPanel) => ({
        ...(existingPanel ?? createSubagentPanelState(threadId)),
        turnId: notificationTurnId(notification),
        status: existingPanel?.status === 'completed' ? existingPanel.status : 'running',
        lastSeenAt: Date.now()
      }))
      return
    }
    case 'item/started': {
      const params = notification.params as { item: CodexThreadItem }
      if (params.item.type === 'collabAgentToolCall') {
        applySubagentActivityItem(params.item)
      }
      seedSubagentStreamingMessage(threadId, params.item)
      return
    }
    case 'item/completed': {
      const params = notification.params as { item: CodexThreadItem }
      if (params.item.type === 'collabAgentToolCall') {
        applySubagentActivityItem(params.item)
      }
      for (const nextMessage of itemToMessages(params.item)) {
        updateSubagentPanelMessages(threadId, (panelMessages) =>
          replaceStreamingMessage(panelMessages, {
            ...nextMessage,
            pending: false
          })
        )
      }
      return
    }
    case 'item/agentMessage/delta':
    case 'item/plan/delta': {
      const params = notification.params as { itemId: string, delta: string }
      appendSubagentTextPartDelta(threadId, params.itemId, params.delta, {
        id: params.itemId,
        role: 'assistant',
        pending: true,
        parts: [{
          type: 'text',
          text: '',
          state: 'streaming'
        }]
      })
      return
    }
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta': {
      const params = notification.params as { itemId: string, delta: string }
      updateSubagentMessage(threadId, params.itemId, {
        id: params.itemId,
        role: 'assistant',
        pending: true,
        parts: [{
          type: 'reasoning',
          summary: [],
          content: [],
          state: 'streaming'
        }]
      }, (message) => {
        const partIndex = message.parts.findIndex(part => part.type === 'reasoning')
        const existingPart = partIndex === -1
          ? {
              type: 'reasoning' as const,
              summary: [],
              content: []
            }
          : message.parts[partIndex] as Extract<ChatPart, { type: 'reasoning' }>
        const nextPart: Extract<ChatPart, { type: 'reasoning' }> = {
          type: 'reasoning',
          summary: notification.method === 'item/reasoning/summaryTextDelta'
            ? [...existingPart.summary, params.delta]
            : existingPart.summary,
          content: notification.method === 'item/reasoning/textDelta'
            ? [...existingPart.content, params.delta]
            : existingPart.content,
          state: 'streaming'
        }
        const nextParts = partIndex === -1
          ? [...message.parts, nextPart]
          : message.parts.map((part, index) => index === partIndex ? nextPart : part)

        return {
          ...message,
          pending: true,
          parts: nextParts
        }
      })
      return
    }
    case 'item/commandExecution/outputDelta': {
      const params = notification.params as { itemId: string, delta: string }
      const fallbackItem = fallbackCommandItemData(params.itemId)
      updateSubagentItemPart(threadId, params.itemId, fallbackCommandMessage(params.itemId), (itemData) => ({
        kind: 'command_execution',
        item: {
          ...(itemData.kind === 'command_execution' ? itemData.item : fallbackItem.item),
          aggregatedOutput: `${(itemData.kind === 'command_execution' ? itemData.item.aggregatedOutput : '') ?? ''}${params.delta}`,
          status: 'inProgress'
        }
      }))
      return
    }
    case 'item/fileChange/outputDelta': {
      const params = notification.params as { itemId: string, delta: string }
      const fallbackItem = fallbackFileChangeItemData(params.itemId)
      updateSubagentItemPart(threadId, params.itemId, fallbackFileChangeMessage(params.itemId), (itemData) => {
        const baseItem: FileChangeItem = itemData.kind === 'file_change'
          ? itemData.item
          : fallbackItem.item
        return {
          kind: 'file_change',
          item: {
            ...baseItem,
            liveOutput: `${baseItem.liveOutput ?? ''}${params.delta}`,
            status: 'inProgress'
          }
        }
      })
      return
    }
    case 'item/mcpToolCall/progress': {
      const params = notification.params as { itemId: string, message: string }
      const fallbackItem = fallbackMcpToolItemData(params.itemId)
      updateSubagentItemPart(threadId, params.itemId, fallbackMcpToolMessage(params.itemId), (itemData) => {
        const baseItem: McpToolCallItem = itemData.kind === 'mcp_tool_call'
          ? itemData.item
          : fallbackItem.item
        return {
          kind: 'mcp_tool_call',
          item: {
            ...baseItem,
            progressMessages: [...(baseItem.progressMessages ?? []), params.message],
            status: 'inProgress'
          }
        }
      })
      return
    }
    case 'turn/completed': {
      upsertSubagentPanel(threadId, (existingPanel) => ({
        ...(existingPanel ?? createSubagentPanelState(threadId)),
        turnId: null,
        status: isSubagentActiveStatus(existingPanel?.status ?? null)
          ? 'completed'
          : existingPanel?.status ?? null,
        lastSeenAt: Date.now()
      }))
      return
    }
    case 'turn/failed': {
      const params = notification.params as { error?: { message?: string } }
      const messageText = params.error?.message ?? 'The turn failed.'
      pushSubagentEventMessage(threadId, 'turn.failed', messageText)
      upsertSubagentPanel(threadId, (existingPanel) => ({
        ...(existingPanel ?? createSubagentPanelState(threadId)),
        status: 'errored',
        turnId: null,
        lastSeenAt: Date.now()
      }))
      return
    }
    case 'stream/error': {
      const params = notification.params as { message?: string }
      const messageText = params.message ?? 'The stream failed.'
      pushSubagentEventMessage(threadId, 'stream.error', messageText)
      upsertSubagentPanel(threadId, (existingPanel) => ({
        ...(existingPanel ?? createSubagentPanelState(threadId)),
        status: 'errored',
        turnId: null,
        lastSeenAt: Date.now()
      }))
      return
    }
    default:
      return
  }
}

const applyNotification = (notification: CodexRpcNotification) => {
  const liveStream = currentLiveStream()
  if (liveStream?.interruptAcknowledged && shouldIgnoreNotificationAfterInterrupt(notification.method)) {
    return
  }

  switch (notification.method) {
    case 'thread/started': {
      const nextThreadId = notificationThreadId(notification)
      if (!nextThreadId) {
        return
      }

      activeThreadId.value = nextThreadId
      pendingThreadId.value = pendingThreadId.value ?? nextThreadId
      return
    }
    case 'thread/name/updated': {
      const nextThreadId = notificationThreadId(notification)
      const nextThreadName = notificationThreadName(notification)
      if (!nextThreadId || !nextThreadName) {
        return
      }
      const nextTitle = normalizeThreadTitleCandidate(nextThreadName)
      if (!nextTitle) {
        return
      }

      if (activeThreadId.value === nextThreadId) {
        threadTitle.value = nextTitle
      }

      updateThreadSummaryTitle(nextThreadId, nextTitle, notificationThreadUpdatedAt(notification))
      return
    }
    case 'turn/started': {
      const nextTurnId = notificationTurnId(notification)
      if (liveStream && !shouldAdvanceLiveStreamTurn({
        lockedTurnId: liveStream.lockedTurnId,
        nextTurnId
      })) {
        return
      }

      if (liveStream) {
        setLiveStreamTurnId(liveStream, nextTurnId)
        setLiveStreamInterruptRequested(liveStream, false)
      }
      messages.value = upsertStreamingMessage(
        messages.value,
        eventToMessage(`event-turn-started-${nextTurnId ?? Date.now()}`, {
          kind: 'turn.started'
        })
      )
      status.value = 'streaming'
      return
    }
    case 'item/started': {
      const params = notification.params as { item: CodexThreadItem }
      if (params.item.type === 'collabAgentToolCall') {
        applySubagentActivityItem(params.item)
      }
      if (params.item.type === 'userMessage') {
        for (const nextMessage of itemToMessages(params.item)) {
          reconcilePendingUserMessage({
            ...nextMessage,
            pending: false
          })
        }
        status.value = 'streaming'
        return
      }
      markAssistantOutputStartedForItem(params.item)
      seedStreamingMessage(params.item)
      status.value = 'streaming'
      return
    }
    case 'item/completed': {
      const params = notification.params as { item: CodexThreadItem }
      if (params.item.type === 'collabAgentToolCall') {
        applySubagentActivityItem(params.item)
      }
      markAssistantOutputStartedForItem(params.item)
      for (const nextMessage of itemToMessages(params.item)) {
        const confirmedMessage = {
          ...nextMessage,
          pending: false
        }
        if (params.item.type === 'userMessage') {
          reconcilePendingUserMessage(confirmedMessage)
          continue
        }

        messages.value = replaceStreamingMessage(messages.value, confirmedMessage)
      }
      return
    }
    case 'item/agentMessage/delta': {
      const params = notification.params as { itemId: string, delta: string }
      markAwaitingAssistantOutput(false)
      appendTextPartDelta(params.itemId, params.delta, {
        id: params.itemId,
        role: 'assistant',
        pending: true,
        parts: [{
          type: 'text',
          text: '',
          state: 'streaming'
        }]
      })
      status.value = 'streaming'
      return
    }
    case 'item/plan/delta': {
      const params = notification.params as { itemId: string, delta: string }
      markAwaitingAssistantOutput(false)
      appendTextPartDelta(params.itemId, params.delta, {
        id: params.itemId,
        role: 'assistant',
        pending: true,
        parts: [{
          type: 'text',
          text: '',
          state: 'streaming'
        }]
      })
      status.value = 'streaming'
      return
    }
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta': {
      const params = notification.params as { itemId: string, delta: string }
      markAwaitingAssistantOutput(false)
      updateMessage(params.itemId, {
        id: params.itemId,
        role: 'assistant',
        pending: true,
        parts: [{
          type: 'reasoning',
          summary: [],
          content: [],
          state: 'streaming'
        }]
      }, (message) => {
        const partIndex = message.parts.findIndex(part => part.type === 'reasoning')
        const existingPart = partIndex === -1
          ? {
              type: 'reasoning' as const,
              summary: [],
              content: []
            }
          : message.parts[partIndex] as Extract<ChatPart, { type: 'reasoning' }>
        const nextPart: Extract<ChatPart, { type: 'reasoning' }> = {
          type: 'reasoning',
          summary: notification.method === 'item/reasoning/summaryTextDelta'
            ? [...existingPart.summary, params.delta]
            : existingPart.summary,
          content: notification.method === 'item/reasoning/textDelta'
            ? [...existingPart.content, params.delta]
            : existingPart.content,
          state: 'streaming'
        }
        const nextParts = partIndex === -1
          ? [...message.parts, nextPart]
          : message.parts.map((part, index) => index === partIndex ? nextPart : part)

        return {
          ...message,
          pending: true,
          parts: nextParts
        }
      })
      status.value = 'streaming'
      return
    }
    case 'item/commandExecution/outputDelta': {
      const params = notification.params as { itemId: string, delta: string }
      const fallbackItem = fallbackCommandItemData(params.itemId)
      updateItemPart(params.itemId, fallbackCommandMessage(params.itemId), (itemData) => ({
        kind: 'command_execution',
        item: {
          ...(itemData.kind === 'command_execution' ? itemData.item : fallbackItem.item),
          aggregatedOutput: `${(itemData.kind === 'command_execution' ? itemData.item.aggregatedOutput : '') ?? ''}${params.delta}`,
          status: 'inProgress'
        }
      }))
      status.value = 'streaming'
      return
    }
    case 'item/fileChange/outputDelta': {
      const params = notification.params as { itemId: string, delta: string }
      const fallbackItem = fallbackFileChangeItemData(params.itemId)
      updateItemPart(params.itemId, fallbackFileChangeMessage(params.itemId), (itemData) => {
        const baseItem: FileChangeItem = itemData.kind === 'file_change'
          ? itemData.item
          : fallbackItem.item
        return {
          kind: 'file_change',
          item: {
            ...baseItem,
            liveOutput: `${baseItem.liveOutput ?? ''}${params.delta}`,
            status: 'inProgress'
          }
        }
      })
      status.value = 'streaming'
      return
    }
    case 'item/mcpToolCall/progress': {
      const params = notification.params as { itemId: string, message: string }
      const fallbackItem = fallbackMcpToolItemData(params.itemId)
      updateItemPart(params.itemId, fallbackMcpToolMessage(params.itemId), (itemData) => {
        const baseItem: McpToolCallItem = itemData.kind === 'mcp_tool_call'
          ? itemData.item
          : fallbackItem.item
        return {
          kind: 'mcp_tool_call',
          item: {
            ...baseItem,
            progressMessages: [...(baseItem.progressMessages ?? []), params.message],
            status: 'inProgress'
          }
        }
      })
      status.value = 'streaming'
      return
    }
    case 'thread/tokenUsage/updated': {
      const nextUsage = normalizeThreadTokenUsage(notification.params)
      if (nextUsage) {
        tokenUsage.value = nextUsage
        if (nextUsage.modelContextWindow != null) {
          modelContextWindow.value = nextUsage.modelContextWindow
        }
      }
      return
    }
    case 'error': {
      const params = notification.params as { error?: { message?: string } }
      const messageText = params.error?.message ?? 'The stream failed.'
      markAwaitingAssistantOutput(false)
      pushEventMessage('stream.error', messageText)
      clearPendingOptimisticMessages(liveStream, { discardSnapshots: true })
      if (liveStream) {
        liveStream.lockedTurnId = null
      }
      clearLiveStream(new Error(messageText))
      error.value = messageText
      status.value = 'error'
      return
    }
    case 'turn/failed': {
      const params = notification.params as { error?: { message?: string } }
      const messageText = params.error?.message ?? 'The turn failed.'
      markAwaitingAssistantOutput(false)
      pushEventMessage('turn.failed', messageText)
      clearPendingOptimisticMessages(liveStream, { discardSnapshots: true })
      if (liveStream) {
        liveStream.lockedTurnId = null
      }
      clearLiveStream(new Error(messageText))
      error.value = messageText
      status.value = 'error'
      return
    }
    case 'stream/error': {
      const params = notification.params as { message?: string }
      const messageText = params.message ?? 'The stream failed.'
      markAwaitingAssistantOutput(false)
      pushEventMessage('stream.error', messageText)
      clearPendingOptimisticMessages(liveStream, { discardSnapshots: true })
      if (liveStream) {
        liveStream.lockedTurnId = null
      }
      clearLiveStream(new Error(messageText))
      error.value = messageText
      status.value = 'error'
      return
    }
    case 'turn/completed': {
      markAwaitingAssistantOutput(false)
      clearPendingOptimisticMessages(liveStream, { discardSnapshots: true })
      if (liveStream) {
        liveStream.lockedTurnId = null
      }
      error.value = null
      status.value = 'ready'
      clearLiveStream()
      return
    }
    default:
      return
  }
}

const sendMessage = async () => {
  if (sendMessageLocked.value || hasPendingRequest.value) {
    return
  }

  sendMessageLocked.value = true
  const rawText = input.value
  const text = rawText.trim()
  const submittedAttachments = attachments.value.slice()

  if (!text && submittedAttachments.length === 0) {
    sendMessageLocked.value = false
    return
  }

  if (await handleSlashCommandSubmission(rawText, submittedAttachments)) {
    sendMessageLocked.value = false
    return
  }

  input.value = ''
  clearAttachments({ revoke: false })

  try {
    await loadPromptControls()
  } catch (caughtError) {
    restoreDraftIfPristine(text, submittedAttachments)
    error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    status.value = 'error'
    sendMessageLocked.value = false
    return
  }

  try {
    if (pendingThreadHydration && shouldAwaitThreadHydration({
      hasPendingThreadHydration: true,
      routeThreadId: routeThreadId.value
    })) {
      await pendingThreadHydration
    }

    pinnedToBottom.value = true
    error.value = null
    attachmentError.value = null
    const submissionMethod = resolveTurnSubmissionMethod(shouldSubmitWithTurnSteer())
    if (submissionMethod === 'turn/start') {
      status.value = 'submitted'
    }
    const optimisticMessage = buildOptimisticMessage(text, submittedAttachments)
    const optimisticMessageId = optimisticMessage.id
    rememberOptimisticAttachments(optimisticMessageId, submittedAttachments)
    messages.value = [...messages.value, optimisticMessage]
    markAwaitingAssistantOutput(shouldAwaitAssistantOutput(submissionMethod))
    let startedLiveStream: LiveStream | null = null
    let executedSubmissionMethod = submissionMethod

    try {
      const client = getClient(props.projectId)

      if (submissionMethod === 'turn/steer') {
        const liveStream = await ensurePendingLiveStream()
        queuePendingUserMessage(liveStream, optimisticMessageId)
        let uploadedAttachments: PersistedProjectAttachment[] | undefined

        try {
          uploadedAttachments = await uploadAttachments(liveStream.threadId, submittedAttachments)
          const turnId = await waitForLiveStreamTurnId(liveStream)

          await client.request<TurnStartResponse>('turn/steer', {
            threadId: liveStream.threadId,
            expectedTurnId: turnId,
            input: buildTurnStartInput(text, uploadedAttachments),
            ...buildTurnOverrides(selectedModel.value, selectedEffort.value)
          })
          tokenUsage.value = null
        } catch (caughtError) {
          const errorToHandle = caughtError instanceof Error ? caughtError : new Error(String(caughtError))
          if (!shouldRetrySteerWithTurnStart(errorToHandle.message)) {
            throw errorToHandle
          }

          executedSubmissionMethod = 'turn/start'
          startedLiveStream = liveStream
          status.value = 'submitted'
          setLiveStreamTurnId(liveStream, null)
          setLiveStreamInterruptRequested(liveStream, false)

          await submitTurnStart({
            client,
            liveStream,
            text,
            submittedAttachments,
            uploadedAttachments,
            optimisticMessageId,
            queueOptimisticMessage: false
          })
        }
        return
      }

      const liveStream = await ensurePendingLiveStream()
      startedLiveStream = liveStream
      await submitTurnStart({
        client,
        liveStream,
        text,
        submittedAttachments,
        optimisticMessageId
      })
    } catch (caughtError) {
      const messageText = caughtError instanceof Error ? caughtError.message : String(caughtError)

      markAwaitingAssistantOutput(false)
      untrackPendingUserMessage(optimisticMessageId)
      removeOptimisticMessage(optimisticMessageId)

      if (executedSubmissionMethod === 'turn/start') {
        if (startedLiveStream && session.liveStream === startedLiveStream) {
          clearPendingOptimisticMessages(clearLiveStream(new Error(messageText)))
        }
        session.pendingLiveStream = null
        restoreDraftIfPristine(text, submittedAttachments)
        error.value = messageText
        status.value = 'error'
        return
      }

      restoreDraftIfPristine(text, submittedAttachments)
      error.value = messageText
    }
  } finally {
    sendMessageLocked.value = false
  }
}

const stopActiveTurn = async () => {
  if (!hasActiveTurnEngagement()) {
    return
  }

  let liveStream: LiveStream | null = null

  try {
    liveStream = await ensurePendingLiveStream()
    if (liveStream.interruptRequested) {
      return
    }

    setLiveStreamInterruptRequested(liveStream, true)
    error.value = null
    const client = getClient(props.projectId)
    const turnId = await waitForLiveStreamTurnId(liveStream)
    await client.request('turn/interrupt', {
      threadId: liveStream.threadId,
      turnId
    })
    liveStream.interruptAcknowledged = true
  } catch (caughtError) {
    if (liveStream) {
      setLiveStreamInterruptRequested(liveStream, false)
    }
    error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
  }
}

const sendStarterPrompt = async (text: string) => {
  if (isBusy.value || hasPendingRequest.value) {
    return
  }

  input.value = text
  await sendMessage()
}

const respondToPendingRequest = (response: unknown) => {
  error.value = null
  resolveCurrentRequest(response)
}

const onPromptKeydown = (event: KeyboardEvent) => {
  if (!slashDropdownOpen.value) {
    return
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveSlashHighlight(1)
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveSlashHighlight(-1)
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    dismissedSlashMatchKey.value = activeSlashMatchKey.value
    isPromptFocused.value = true
    void focusPromptAt(promptSelectionStart.value)
    return
  }

  if (event.key === 'Tab' || event.key === ' ') {
    const command = highlightedSlashCommand.value
    if (!command || (event.key === ' ' && !command.completeOnSpace)) {
      return
    }

    event.preventDefault()
    void activateSlashCommand(command, 'complete')
  }
}

const onPromptEnter = (event: KeyboardEvent) => {
  if (!shouldSubmit(event)) {
    return
  }

  if (slashDropdownOpen.value) {
    const command = highlightedSlashCommand.value
    if (command) {
      event.preventDefault()
      const isExactMatch = activeSlashMatch.value?.query === command.name
      const action = isExactMatch && command.executeOnEnter && !command.supportsInlineArgs
        ? 'execute'
        : 'complete'
      void activateSlashCommand(command, action)
      return
    }
  }

  event.preventDefault()
  void sendMessage()
}

onMounted(() => {
  releaseServerRequestHandler = getClient(props.projectId).setServerRequestHandler(handleServerRequest)
  if (!loaded.value) {
    void refreshProjects()
  }

  void loadPromptControls()
  void scheduleScrollToBottom('auto')
})

onBeforeUnmount(() => {
  cancelAllPendingRequests()
  releaseServerRequestHandler?.()
  releaseServerRequestHandler = null
})

watch(() => props.threadId ?? null, (threadId) => {
  if (!threadId) {
    if (isBusy.value || pendingThreadId.value) {
      return
    }

    resetDraftThread()
    return
  }

  if (
    autoRedirectThreadId.value === threadId
    && activeThreadId.value === threadId
    && isBusy.value
  ) {
    autoRedirectThreadId.value = null
    pendingThreadId.value = null
    return
  }

  void hydrateThread(threadId)
}, { immediate: true })

watch(pendingThreadId, async (threadId) => {
  if (!threadId) {
    return
  }

  if (routeThreadId.value === threadId) {
    pendingThreadId.value = null
    autoRedirectThreadId.value = null
    return
  }

  autoRedirectThreadId.value = threadId
  await router.push(toProjectThreadRoute(props.projectId, threadId))
  pendingThreadId.value = null
})

watch(messages, () => {
  void scheduleScrollToBottom(status.value === 'streaming' ? 'auto' : 'smooth')
}, { flush: 'post' })

watch(status, (nextStatus, previousStatus) => {
  if (nextStatus === previousStatus) {
    return
  }

  void scheduleScrollToBottom(nextStatus === 'streaming' ? 'auto' : 'smooth')
}, { flush: 'post' })

watch(filteredSlashCommands, (commands) => {
  if (!commands.length) {
    slashHighlightIndex.value = 0
    return
  }

  if (slashHighlightIndex.value >= commands.length) {
    slashHighlightIndex.value = 0
  }
}, { flush: 'sync' })

watch([selectedModel, availableModels], () => {
  const nextSelection = coercePromptSelection(effectiveModelList.value, selectedModel.value, selectedEffort.value)
  if (selectedModel.value !== nextSelection.model) {
    selectedModel.value = nextSelection.model
    return
  }

  if (selectedEffort.value !== nextSelection.effort) {
    selectedEffort.value = nextSelection.effort
  }
}, { flush: 'sync' })

watch(input, async () => {
  await nextTick()
  syncPromptSelectionFromDom()
}, { flush: 'post' })
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-default">
    <div
      ref="scrollViewport"
      class="min-h-0 flex-1 overflow-y-auto"
      @scroll="updatePinnedState"
    >
      <div
        v-if="showWelcomeState"
        class="flex min-h-full items-center justify-center px-6 py-10"
      >
        <div class="flex w-full max-w-4xl flex-col items-center gap-10 text-center">
          <div class="space-y-4">
            <div class="text-xs font-medium uppercase tracking-[0.28em] text-primary">
              Ready To Code
            </div>
            <div class="space-y-2">
              <h1 class="text-balance text-4xl font-semibold tracking-tight text-highlighted md:text-5xl">
                Let's build
              </h1>
              <p class="text-balance text-3xl font-medium tracking-tight text-toned md:text-4xl">
                {{ projectTitle }}
              </p>
            </div>
            <p class="mx-auto max-w-2xl text-base leading-7 text-muted md:text-lg">
              Start with a goal, a bug, or a question. Codori will start the runtime when needed and keep the thread ready to continue.
            </p>
          </div>

          <div class="grid w-full gap-3 md:grid-cols-3">
            <button
              v-for="prompt in starterPrompts"
              :key="prompt.title"
              type="button"
              class="rounded-3xl border border-default/70 bg-elevated/25 px-5 py-5 text-left transition hover:border-primary/30 hover:bg-elevated/45"
              @click="sendStarterPrompt(prompt.text)"
            >
              <div class="text-sm font-semibold text-highlighted">
                {{ prompt.title }}
              </div>
              <p class="mt-3 text-sm leading-6 text-muted">
                {{ prompt.text }}
              </p>
            </button>
          </div>
        </div>
      </div>

      <UChatMessages
        v-else
        :messages="messages"
        :status="chatMessagesStatus"
        :should-auto-scroll="false"
        :should-scroll-to-bottom="false"
        :auto-scroll="false"
        :spacing-offset="140"
        :user="{
          ui: {
            root: 'scroll-mt-4',
            container: 'gap-3 pb-8',
            content: 'px-4 py-3 rounded-2xl min-h-12'
          }
        }"
        :ui="{
          root: 'min-h-full px-4 py-5 md:px-6',
          message: 'max-w-none',
          content: 'w-full max-w-5xl'
        }"
        compact
      >
        <template #content="{ message }">
          <MessageContent
            :message="message as ChatMessage"
            :project-id="projectId"
          />
        </template>
        <template #indicator>
          <UChatShimmer
            v-if="awaitingAssistantOutput"
            text="Thinking..."
            class="px-1 py-2"
          />
        </template>
      </UChatMessages>
    </div>

    <div class="sticky bottom-0 shrink-0 border-t border-default bg-default/95 px-4 py-3 backdrop-blur md:px-6">
      <div class="mx-auto w-full max-w-5xl">
        <UAlert
          v-if="composerError"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="composerError"
          class="mb-3"
        />

        <div
          v-if="pendingRequest"
          class="mb-3 rounded-2xl border border-primary/30 bg-primary/8 px-4 py-3 text-sm text-default"
        >
          Codex is waiting for the response in the drawer below. Normal chat sending is paused until you answer it.
        </div>

        <div
          class="relative"
          @dragenter="onDragEnter"
          @dragleave="onDragLeave"
          @dragover="onDragOver"
          @drop="onDrop"
        >
          <div
            v-if="isDragging"
            class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-3xl border border-dashed border-primary/50 bg-primary/10 text-sm font-medium text-primary backdrop-blur-sm"
          >
            Drop images to attach them
          </div>

          <div
            v-if="slashDropdownOpen"
            ref="slashDropdownRef"
            role="listbox"
            aria-label="Slash commands"
            class="absolute bottom-full left-0 z-20 mb-2 w-[90vw] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-default bg-default/95 shadow-2xl backdrop-blur md:w-[min(50vw,52rem)] md:max-w-[min(50vw,52rem)]"
            @pointerdown="handleSlashDropdownPointerDown"
          >
            <!-- Do not swap this back to a focus-managing listbox/palette. Slash
                 suggestions are anchored to the textarea selection state; the
                 popup must remain an inert overlay or the first `/` can move
                 focus out of the composer and permanently collapse matching. -->
            <div class="max-h-72 space-y-1 overflow-y-auto p-2">
              <div
                v-for="(command, index) in filteredSlashCommands"
                :key="command.name"
                role="option"
                :aria-selected="index === slashHighlightIndex"
                data-slash-command-option=""
                class="group relative flex cursor-pointer items-start gap-1.5 px-3 py-2.5 text-sm text-highlighted outline-none transition-colors before:absolute before:inset-px before:z-[-1] before:rounded-md"
                :class="index === slashHighlightIndex
                  ? 'before:bg-elevated'
                  : 'hover:before:bg-elevated/60'"
                @click="void activateSlashCommand(command, command.supportsInlineArgs ? 'complete' : 'execute')"
              >
                <UIcon
                  :name="resolveSlashCommandIcon(command)"
                  class="mt-0.5 size-4 shrink-0 text-dimmed group-aria-selected:text-highlighted"
                />
                <div class="min-w-0">
                  <div class="text-sm font-medium">
                    /{{ command.name }}
                  </div>
                  <div class="text-xs leading-5 text-toned">
                    {{ command.description }}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <UChatPrompt
            ref="chatPromptRef"
            v-model="input"
            :placeholder="composerPlaceholder"
            :error="submitError"
            :disabled="isComposerDisabled"
            autoresize
            @submit.prevent="sendMessage"
            @keydown="onPromptKeydown"
            @keydown.enter="onPromptEnter"
            @input="syncPromptSelectionFromDom"
            @click="syncPromptSelectionFromDom"
            @keyup="syncPromptSelectionFromDom"
            @focus="isPromptFocused = true; syncPromptSelectionFromDom()"
            @blur="handlePromptBlur"
            @select="syncPromptSelectionFromDom"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
            @paste="onPaste"
          >
            <template #header>
              <div
                v-if="attachments.length"
                class="flex flex-wrap gap-2 pb-2"
              >
                <div
                  v-for="attachment in attachments"
                  :key="attachment.id"
                  class="flex max-w-full items-center gap-2 rounded-2xl border border-default bg-elevated/35 px-2 py-1.5"
                >
                  <img
                    :src="attachment.previewUrl"
                    :alt="attachment.name"
                    class="size-10 rounded-xl object-cover"
                  >
                  <div class="min-w-0">
                    <div class="max-w-40 truncate text-xs font-medium text-highlighted">
                      {{ attachment.name }}
                    </div>
                    <div class="text-[11px] text-muted">
                      {{ formatAttachmentSize(attachment.size) }}
                    </div>
                  </div>
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-x"
                    :disabled="isComposerDisabled"
                    class="rounded-full"
                    :aria-label="`Remove ${attachment.name}`"
                    @click="removeAttachment(attachment.id)"
                  />
                </div>
              </div>
            </template>

            <UChatPromptSubmit
              :status="promptSubmitStatus"
              @stop="stopActiveTurn"
            />

            <template #footer>
              <input
                ref="fileInput"
                type="file"
                accept="image/*"
                class="hidden"
                :disabled="isComposerDisabled"
                @change="onFileInputChange"
              >

              <div class="flex w-full flex-wrap items-center gap-2 pt-1">
                <div class="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <UButton
                    type="button"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    icon="i-lucide-plus"
                    :disabled="isComposerDisabled"
                    class="size-8 shrink-0 justify-center rounded-full border border-default/70"
                    :ui="{ leadingIcon: 'size-4', base: 'px-0' }"
                    aria-label="Attach image"
                    @click="openFilePicker"
                  />

                  <USelect
                    v-model="selectedModel"
                    :items="modelSelectItems"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :loading="promptControlsLoading"
                    :disabled="isComposerDisabled"
                    class="min-w-0 flex-1 sm:max-w-52 sm:flex-none"
                    :ui="{ base: 'rounded-full border border-default/70 bg-default/70', value: 'truncate', content: 'min-w-56' }"
                  />

                  <USelect
                    v-model="selectedEffort"
                    :items="effortSelectItems"
                    color="neutral"
                    variant="ghost"
                    size="sm"
                    :disabled="isComposerDisabled"
                    class="min-w-0 flex-1 sm:max-w-36 sm:flex-none"
                    :ui="{ base: 'rounded-full border border-default/70 bg-default/70', value: 'truncate' }"
                  />
                </div>

                <div class="ml-auto flex shrink-0 items-center">
                  <UPopover
                    v-if="showContextIndicator"
                    :content="{ side: 'top', align: 'end' }"
                    arrow
                  >
                    <button
                      type="button"
                      class="flex h-8 shrink-0 items-center gap-2 px-0 text-left text-muted"
                    >
                      <span class="relative flex size-7 items-center justify-center">
                        <svg
                          viewBox="0 0 36 36"
                          class="size-7 -rotate-90"
                          aria-hidden="true"
                        >
                          <circle
                            cx="18"
                            cy="18"
                            r="15.5"
                            fill="none"
                            stroke-width="3"
                            pathLength="100"
                            class="stroke-current text-muted/20"
                            stroke-dasharray="100 100"
                          />
                          <circle
                            cx="18"
                            cy="18"
                            r="15.5"
                            fill="none"
                            stroke-width="3"
                            pathLength="100"
                            class="stroke-current text-primary"
                            stroke-linecap="round"
                            :stroke-dasharray="`${contextUsedPercent} 100`"
                          />
                        </svg>
                        <span class="absolute text-[9px] font-semibold text-highlighted">
                          {{ contextIndicatorLabel }}
                        </span>
                      </span>
                    </button>

                    <template #content>
                      <div class="w-72 space-y-3 p-4">
                        <div class="space-y-1">
                          <div class="text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                            Context Window
                          </div>
                          <div class="text-sm font-medium text-highlighted">
                            {{ selectedModelOption?.displayName ?? 'Selected model' }}
                          </div>
                        </div>

                        <div class="grid grid-cols-2 gap-3 text-sm">
                          <div class="rounded-2xl border border-default bg-elevated/35 px-3 py-2">
                            <div class="text-[11px] uppercase tracking-[0.18em] text-muted">
                              Remaining
                            </div>
                            <div class="mt-1 font-semibold text-highlighted">
                              {{ Math.round(contextWindowState.remainingPercent ?? 0) }}%
                            </div>
                            <div class="text-xs text-muted">
                              {{ formatCompactTokenCount(contextWindowState.remainingTokens ?? 0) }} tokens
                            </div>
                          </div>
                          <div class="rounded-2xl border border-default bg-elevated/35 px-3 py-2">
                            <div class="text-[11px] uppercase tracking-[0.18em] text-muted">
                              Used
                            </div>
                            <div class="mt-1 font-semibold text-highlighted">
                              {{ formatCompactTokenCount(contextWindowState.usedTokens ?? 0) }}
                            </div>
                            <div class="text-xs text-muted">
                              of {{ formatCompactTokenCount(contextWindowState.contextWindow ?? 0) }}
                            </div>
                          </div>
                        </div>

                        <div class="grid grid-cols-2 gap-3 text-sm">
                          <div class="rounded-2xl border border-default bg-elevated/35 px-3 py-2">
                            <div class="text-[11px] uppercase tracking-[0.18em] text-muted">
                              Input
                            </div>
                            <div class="mt-1 font-semibold text-highlighted">
                              {{ formatCompactTokenCount(tokenUsage?.totalInputTokens ?? 0) }}
                            </div>
                            <div class="text-xs text-muted">
                              cached {{ formatCompactTokenCount(tokenUsage?.totalCachedInputTokens ?? 0) }}
                            </div>
                          </div>
                          <div class="rounded-2xl border border-default bg-elevated/35 px-3 py-2">
                            <div class="text-[11px] uppercase tracking-[0.18em] text-muted">
                              Output
                            </div>
                            <div class="mt-1 font-semibold text-highlighted">
                              {{ formatCompactTokenCount(tokenUsage?.totalOutputTokens ?? 0) }}
                            </div>
                            <div class="text-xs text-muted">
                              effort {{ formatReasoningEffortLabel(selectedEffort) }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </template>
                  </UPopover>
                </div>
              </div>
            </template>
          </UChatPrompt>
        </div>
      </div>
    </div>
  </section>

  <PendingUserRequestDrawer
    :request="pendingRequest"
    @respond="respondToPendingRequest"
  />

  <ReviewStartDrawer
    :open="reviewDrawerOpen"
    :mode="reviewDrawerMode"
    :branches="reviewBaseBranches"
    :current-branch="reviewCurrentBranch"
    :loading="reviewBranchesLoading"
    :submitting="reviewStartPending"
    :error="reviewBranchesError"
    @update:open="handleReviewDrawerOpenChange"
    @choose-current-changes="startReview({ type: 'uncommittedChanges' })"
    @choose-base-branch-mode="openBaseBranchPicker"
    @choose-base-branch="(branch) => startReview({ type: 'baseBranch', branch })"
    @back="handleReviewDrawerBack"
  />

  <UsageStatusModal
    :project-id="props.projectId"
    :open="usageStatusModalOpen"
    @update:open="handleUsageStatusOpenChange"
  />
</template>

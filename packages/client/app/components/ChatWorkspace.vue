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
import LocalFileViewerModal from './LocalFileViewerModal.vue'
import MessageContent from './MessageContent.vue'
import PlanTaskListPanel from './PlanTaskListPanel.vue'
import PlanImplementationPromptDrawer from './PlanImplementationPromptDrawer.vue'
import ReviewStartDrawer from './ReviewStartDrawer.vue'
import PendingUserRequestDrawer from './PendingUserRequestDrawer.vue'
import UsageStatusModal from './UsageStatusModal.vue'
import WorkspaceBranchControl from './WorkspaceBranchControl.vue'
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
import { useChatPlanWorkflow } from '../composables/useChatPlanWorkflow'
import { useChatReviewWorkflow } from '../composables/useChatReviewWorkflow'
import { useSubagentPanelsController } from '../composables/useSubagentPanelsController'
import { usePendingUserRequest } from '../composables/usePendingUserRequest'
import { useChatSession, type LiveStream } from '../composables/useChatSession'
import { useChats } from '../composables/useChats'
import { useProjects } from '../composables/useProjects'
import { useRpc } from '../composables/useRpc'
import { useChatSubmitGuard } from '../composables/useChatSubmitGuard'
import { useWorkspaceGitBranch } from '../composables/useWorkspaceGitBranch'
import {
  normalizeThreadTitleCandidate,
  resolveThreadSummaryTitle,
  useThreadSummaries
} from '../composables/useThreadSummaries'
import { resolveChatMessagesStatus, shouldAwaitAssistantOutput } from '../utils/chat-messages-status'
import {
  ITEM_PART,
  eventToMessage,
  findLatestCompletedPlanTurnId,
  findLatestPlanTurnId,
  isSubagentActiveStatus,
  itemToMessages,
  replaceStreamingMessage,
  threadToMessages,
  upsertStreamingMessage,
  type ChatMessage,
  type ChatPart,
  type FileChangeItem,
  type ItemData,
  type McpToolCallItem,
  type WebSearchStatus
} from '~~/shared/codex-chat'
import { buildTurnStartInput, type PersistedProjectAttachment } from '~~/shared/chat-attachments'
import {
  type CollaborationMode
} from '~~/shared/collaboration-mode'
import type { ConfigReadParams } from '~~/shared/generated/codex-app-server/v2/ConfigReadParams'
import type { ConfigReadResponse } from '~~/shared/generated/codex-app-server/v2/ConfigReadResponse'
import type { ModelListResponse } from '~~/shared/generated/codex-app-server/v2/ModelListResponse'
import type { ThreadReadResponse } from '~~/shared/generated/codex-app-server/v2/ThreadReadResponse'
import type { ThreadItem } from '~~/shared/generated/codex-app-server/v2/ThreadItem'
import type { ThreadResumeResponse } from '~~/shared/generated/codex-app-server/v2/ThreadResumeResponse'
import type { ThreadStartResponse } from '~~/shared/generated/codex-app-server/v2/ThreadStartResponse'
import type { TurnStartResponse } from '~~/shared/generated/codex-app-server/v2/TurnStartResponse'
import type { ReasoningEffort } from '~~/shared/generated/codex-app-server/ReasoningEffort'
import {
  notificationRequestId,
  notificationTurnStatus,
  notificationThreadName,
  notificationThreadId,
  notificationThreadUpdatedAt,
  notificationTurnId,
  type CodexRpcNotification,
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
  visibleModelOptions
} from '~~/shared/chat-prompt-controls'
import { toProjectThreadRoute } from '~~/shared/codori'
import {
  filterSlashCommands,
  findActiveSlashCommand,
  parseSubmittedSlashCommand,
  SLASH_COMMANDS,
  toSlashCommandCompletion,
  type SlashCommandDefinition
} from '~~/shared/slash-commands'
import { resolveSlashCommandDispatch } from '~~/shared/slash-command-dispatch'
import {
  buildFileAutocompletePathSegments,
  normalizeFileAutocompleteQuery,
  normalizeFuzzyFileSearchMatches,
  replaceActiveFileAutocompleteMatch,
  toFileAutocompleteHandle,
  type FileAutocompletePathSegment,
  type NormalizedFuzzyFileSearchMatch
} from '~~/shared/file-autocomplete'
import {
  buildMentionAutocompleteSubmission,
  filterAgentMentionEntries,
  filterPluginMentionEntries,
  findActiveMentionAutocompleteMatch,
  normalizePluginListResponse,
  reconcileMentionAutocompleteSelections,
  replaceActiveMentionAutocompleteMatch,
  resolveMentionAutocompleteScore,
  resolvePluginMentionIconUrl,
  toAgentMentionToken,
  toPluginMentionToken,
  type AgentMentionAutocompleteEntry,
  type MentionAutocompleteSelection,
  type PluginMentionAutocompleteEntry
} from '~~/shared/mention-autocomplete'
import {
  filterSkillAutocompleteEntries,
  findActiveSkillAutocompleteMatch,
  hasSkillAutocompleteMentions,
  normalizeSkillsListResponse,
  preprocessSkillMentionsForSubmission,
  reconcileSkillAutocompleteSelections,
  replaceActiveSkillAutocompleteMatch,
  toSkillAutocompleteCompletion,
  type SkillAutocompleteEntry,
  type SkillAutocompleteSelection
} from '~~/shared/skill-autocomplete'
import {
  resolveSubagentAccent,
  toSubagentAvatarText
} from '~~/shared/subagent-panels'
const props = defineProps<{
  projectId?: string
  chatId?: string
  workspaceKind?: 'project' | 'chat'
  threadId?: string | null
  autoStartThread?: boolean
}>()
const workspaceKind = props.workspaceKind ?? 'project'
const workspaceId = workspaceKind === 'chat' ? props.chatId ?? '' : props.projectId ?? ''
const workspaceSessionKey = `${workspaceKind}:${workspaceId}`
const workspaceScope = workspaceKind === 'chat'
  ? { kind: 'chat' as const, id: workspaceId }
  : { kind: 'project' as const, id: workspaceId }
const routeThreadId = computed(() => props.threadId ?? null)

const router = useRouter()
const runtimeConfig = useRuntimeConfig()
const { getWorkspaceClient } = useRpc()
const {
  loaded,
  refreshProjects,
  getProject,
  startProject
} = useProjects()
const {
  loaded: chatsLoaded,
  refreshChats,
  getChat,
  renameChat,
  setChatThread,
  startChat
} = useChats()
const getRuntimeClient = () => getWorkspaceClient(workspaceScope)
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
} = useChatAttachments(workspaceScope)
const input = ref('')
const chatPromptRef = ref<{
  textareaRef?: unknown
} | null>(null)
const slashDropdownRef = ref<HTMLElement | null>(null)
const skillAutocompleteDropdownRef = ref<HTMLElement | null>(null)
const skillAutocompleteListRef = ref<HTMLElement | null>(null)
const mentionAutocompleteDropdownRef = ref<HTMLElement | null>(null)
const mentionAutocompleteListRef = ref<HTMLElement | null>(null)
const scrollViewport = ref<HTMLElement | null>(null)
const stickyFooterRef = ref<HTMLElement | null>(null)
const stickyFooterHeight = ref(140)
const pinnedToBottom = ref(true)
const session = useChatSession(workspaceSessionKey)
const { syncThreadSummary, updateThreadSummaryTitle } = useThreadSummaries(workspaceSessionKey)
const {
  messages,
  subagentPanels,
  threadPlans,
  threadCollaborationModeMasks,
  collaborationModeMasks,
  collaborationModesLoaded,
  collaborationModesLoading,
  collaborationModesError,
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
  tokenUsage,
  latestPlanTurnId,
  queuedPlanImplementationPromptTurnId,
  queuedPlanImplementationPromptThreadId,
  planImplementationPromptTurnId,
  planImplementationPromptThreadId
} = session
const {
  pendingRequest,
  hasPendingRequest,
  handleServerRequest,
  resolveRequest,
  markRequestResolved
} = usePendingUserRequest(
  workspaceSessionKey,
  computed(() => activeThreadId.value ?? routeThreadId.value),
  activeThreadId
)

type MentionAutocompletePaletteItem =
  | {
      kind: 'agent'
      key: string
      label: string
      description: string | null
      agent: AgentMentionAutocompleteEntry
      accentIndex: number
    }
  | {
      kind: 'plugin'
      key: string
      label: string
      description: string | null
      plugin: PluginMentionAutocompleteEntry
    }
  | {
      kind: 'file'
      key: string
      label: string
      description: string | null
      file: NormalizedFuzzyFileSearchMatch
    }

type MentionAutocompletePaletteSection = {
  key: string
  title: string
  items: MentionAutocompletePaletteItem[]
}

const selectedChat = computed(() => workspaceKind === 'chat' ? getChat(workspaceId) : null)
const selectedProject = computed(() => {
  if (workspaceKind === 'chat') {
    const chat = selectedChat.value
    return chat
      ? {
          projectId: chat.chatId,
          projectPath: chat.chatPath,
          status: chat.status
        }
      : null
  }

  return getProject(workspaceId)
})
const supportsWorkspaceGit = computed(() => workspaceKind === 'project')
const isChatSessionWorkspace = computed(() => workspaceKind === 'chat')
const workspaceGitBranch = useWorkspaceGitBranch({
  projectId: workspaceId,
  serverBase: String(runtimeConfig.public.serverBase ?? ''),
  supportsGit: () => supportsWorkspaceGit.value
})
const {
  currentBranch: workspaceCurrentBranch,
  availableBranches: workspaceAvailableBranches,
  loading: workspaceGitBranchLoading,
  submitting: workspaceGitBranchSubmitting,
  error: workspaceGitBranchError,
  showBranchControl: showWorkspaceBranchControl,
  refreshBranchesForActivity: refreshWorkspaceGitBranchesForActivity,
  refreshBranchesForEnvironmentSignal: refreshWorkspaceGitBranchesForEnvironmentSignal,
  switchBranch: switchWorkspaceGitBranch,
  createBranch: createWorkspaceGitBranch
} = workspaceGitBranch
const mentionSubmission = computed(() =>
  buildMentionAutocompleteSubmission(insertedMentionSelections.value)
)
const multiAgentMentionError = computed(() =>
  mentionSubmission.value.agentThreadIds.length > 1
    ? 'Send to one agent at a time.'
    : null
)
const composerError = computed(() =>
  attachmentError.value
  ?? multiAgentMentionError.value
  ?? error.value
)
const submitError = computed(() => composerError.value ? new Error(composerError.value) : undefined)
const interruptRequested = ref(false)
const awaitingAssistantOutput = ref(false)
const sendMessageLocked = ref(false)
const promptSelectionStart = ref(0)
const promptSelectionEnd = ref(0)
const isPromptFocused = ref(false)
const dismissedSlashMatchKey = ref<string | null>(null)
const dismissedSkillAutocompleteMatchKey = ref<string | null>(null)
const dismissedMentionAutocompleteMatchKey = ref<string | null>(null)
const slashHighlightIndex = ref(0)
const skillAutocompleteHighlightIndex = ref(0)
const mentionAutocompleteHighlightIndex = ref(0)
const mentionAutocompleteUserNavigated = ref(false)
const pluginMentionLoading = ref(false)
const pluginMentionError = ref<string | null>(null)
const pluginMentionCatalog = ref<PluginMentionAutocompleteEntry[]>([])
const pluginMentionCatalogCwd = ref<string | null>(null)
const insertedMentionSelections = ref<MentionAutocompleteSelection[]>([])
const skillAutocompleteLoading = ref(false)
const skillAutocompleteError = ref<string | null>(null)
const skillAutocompleteCatalog = ref<SkillAutocompleteEntry[]>([])
const skillAutocompleteCatalogCwd = ref<string | null>(null)
const skillAutocompleteCatalogVersion = ref(-1)
const skillAutocompleteInvalidationVersion = ref(0)
const insertedSkillMentions = ref<SkillAutocompleteSelection[]>([])
const fileAutocompleteLoading = ref(false)
const fileAutocompleteError = ref<string | null>(null)
const fileAutocompleteResults = ref<NormalizedFuzzyFileSearchMatch[]>([])
const usageStatusModalOpen = ref(false)
const isWorkflowBusy = computed(() =>
  status.value === 'submitted'
  || status.value === 'streaming'
  || isUploading.value
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
const promptSubmitStatus = computed(() =>
  resolvePromptSubmitStatus({
    status: status.value,
    hasDraftContent: hasDraftContent.value
  })
)
const projectTitle = computed(() => selectedProject.value?.projectId ?? workspaceId)
const composerPlaceholder = computed(() =>
  hasPendingRequest.value
    ? 'Respond to the pending request below to let Codex continue'
    : isPlanModeActive.value
      ? 'Describe what you want Codex to plan'
      : 'Describe the change you want Codex to make'
)
const chatMessagesStatus = computed(() =>
  resolveChatMessagesStatus(status.value, awaitingAssistantOutput.value)
)
const chatSpacingOffset = computed(() =>
  Math.max(140, stickyFooterHeight.value + 24)
)
const showWelcomeState = computed(() =>
  !routeThreadId.value
  && !activeThreadId.value
  && messages.value.length === 0
  && !isBusy.value
)

const slashCommands = computed(() =>
  SLASH_COMMANDS
    .filter(() => !hasPendingRequest.value)
    .map((command) => {
      if (command.name !== 'plan' || !collaborationModesLoaded.value || planCollaborationModeMask.value) {
        return command
      }

      return {
        ...command,
        description: 'Plan mode is unavailable in the current runtime.'
      }
    })
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

const activeSkillAutocompleteMatch = computed(() =>
  isPromptFocused.value
    ? findActiveSkillAutocompleteMatch(input.value, promptSelectionStart.value, promptSelectionEnd.value)
    : null
)

const activeSkillAutocompleteMatchKey = computed(() => {
  const match = activeSkillAutocompleteMatch.value
  if (!match) {
    return null
  }

  return `${match.start}:${match.end}:${match.raw}`
})

const filteredSkillAutocompleteResults = computed(() =>
  activeSkillAutocompleteMatch.value
    ? filterSkillAutocompleteEntries(skillAutocompleteCatalog.value, activeSkillAutocompleteMatch.value.query)
      .slice(0, 8)
    : []
)

const activeMentionAutocompleteMatch = computed(() =>
  isPromptFocused.value
    ? findActiveMentionAutocompleteMatch(input.value, promptSelectionStart.value, promptSelectionEnd.value)
    : null
)

const activeMentionAutocompleteMatchKey = computed(() => {
  const match = activeMentionAutocompleteMatch.value
  if (!match) {
    return null
  }

  return `${match.start}:${match.end}:${match.raw}`
})

const normalizedMentionAutocompleteQuery = computed(() =>
  activeMentionAutocompleteMatch.value
    ? normalizeFileAutocompleteQuery(activeMentionAutocompleteMatch.value.query)
    : ''
)

const activeAgentMentionEntries = computed(() =>
  [...subagentPanels.value]
    .filter(panel => isSubagentActiveStatus(panel.status))
    .sort((left, right) => left.firstSeenAt - right.firstSeenAt)
    .map((panel) => ({
      threadId: panel.threadId,
      name: panel.name,
      role: panel.role ?? null,
      status: panel.status
    } satisfies AgentMentionAutocompleteEntry))
)

const agentMentionAccentIndexByThreadId = computed(() => {
  const entries = new Map<string, number>()

  for (const [index, panel] of activeAgentMentionEntries.value.entries()) {
    entries.set(panel.threadId, index)
  }

  return entries
})

const filteredAgentMentionResults = computed(() =>
  activeMentionAutocompleteMatch.value
    ? filterAgentMentionEntries(activeAgentMentionEntries.value, activeMentionAutocompleteMatch.value.query)
    : []
)

const filteredPluginMentionResults = computed(() =>
  activeMentionAutocompleteMatch.value
    ? filterPluginMentionEntries(pluginMentionCatalog.value, activeMentionAutocompleteMatch.value.query)
      .slice(0, activeMentionAutocompleteMatch.value.query.trim() ? 8 : 6)
    : []
)

const visibleMentionFileResults = computed(() =>
  activeMentionAutocompleteMatch.value && normalizedMentionAutocompleteQuery.value
    ? fileAutocompleteResults.value
      .filter((match: NormalizedFuzzyFileSearchMatch) => match.matchType === 'file')
      .slice(0, 8)
    : []
)

const mentionAutocompleteOpen = computed(() =>
  !reviewDrawerOpen.value
  && Boolean(activeMentionAutocompleteMatch.value)
  && activeMentionAutocompleteMatchKey.value !== dismissedMentionAutocompleteMatchKey.value
)

const mentionAutocompleteSections = computed<MentionAutocompletePaletteSection[]>(() => {
  if (!mentionAutocompleteOpen.value) {
    return []
  }

  const sections: MentionAutocompletePaletteSection[] = []

  if (visibleMentionFileResults.value.length > 0) {
    sections.push({
      key: 'files',
      title: 'Files',
      items: visibleMentionFileResults.value.map((file: NormalizedFuzzyFileSearchMatch) => ({
        kind: 'file',
        key: `file:${file.matchType}:${file.path}`,
        label: file.fileName,
        description: file.path,
        file
      }))
    })
  }

  if (filteredAgentMentionResults.value.length > 0) {
    sections.push({
      key: 'agents',
      title: 'Agents',
      items: filteredAgentMentionResults.value.map((agent) => ({
        kind: 'agent',
        key: `agent:${agent.threadId}`,
        label: agent.name,
        description: agent.role ?? null,
        agent,
        accentIndex: agentMentionAccentIndexByThreadId.value.get(agent.threadId) ?? 0
      }))
    })
  }

  if (filteredPluginMentionResults.value.length > 0) {
    sections.push({
      key: 'plugins',
      title: 'Plugins',
      items: filteredPluginMentionResults.value.map((plugin) => ({
        kind: 'plugin',
        key: `plugin:${plugin.id}`,
        label: plugin.displayName?.trim() || plugin.name,
        description: plugin.shortDescription ?? plugin.longDescription ?? null,
        plugin
      }))
    })
  }

  return sections
})

const flatMentionAutocompleteItems = computed(() =>
  mentionAutocompleteSections.value.flatMap(section => section.items)
)

const resolveMentionAutocompleteItemScore = (
  item: MentionAutocompletePaletteItem,
  query: string
) => {
  if (item.kind === 'agent') {
    return resolveMentionAutocompleteScore(query, [
      item.agent.name,
      item.agent.role
    ])
  }

  if (item.kind === 'plugin') {
    return resolveMentionAutocompleteScore(query, [
      item.plugin.displayName,
      item.plugin.name,
      item.plugin.marketplaceName,
      item.plugin.category,
      item.plugin.shortDescription,
      item.plugin.longDescription,
      item.plugin.developerName
    ])
  }

  return resolveMentionAutocompleteScore(query, [
    item.file.fileName,
    item.file.path
  ])
}

const bestMentionAutocompleteHighlightIndex = computed(() => {
  const items = flatMentionAutocompleteItems.value
  if (items.length === 0) {
    return 0
  }

  const query = activeMentionAutocompleteMatch.value?.query ?? ''
  let bestIndex = 0
  let bestScore = Number.NEGATIVE_INFINITY

  for (const [index, item] of items.entries()) {
    const score = resolveMentionAutocompleteItemScore(item, query)
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }

  return bestIndex
})

const effectiveMentionAutocompleteHighlightIndex = computed(() => {
  if (
    mentionAutocompleteUserNavigated.value
    && mentionAutocompleteHighlightIndex.value >= 0
    && mentionAutocompleteHighlightIndex.value < flatMentionAutocompleteItems.value.length
  ) {
    return mentionAutocompleteHighlightIndex.value
  }

  return bestMentionAutocompleteHighlightIndex.value
})

const highlightedMentionAutocompleteItem = computed(() =>
  flatMentionAutocompleteItems.value[effectiveMentionAutocompleteHighlightIndex.value]
  ?? flatMentionAutocompleteItems.value[0]
  ?? null
)

const skillAutocompleteOpen = computed(() =>
  !reviewDrawerOpen.value
  && !mentionAutocompleteOpen.value
  && Boolean(activeSkillAutocompleteMatch.value)
  && activeSkillAutocompleteMatchKey.value !== dismissedSkillAutocompleteMatchKey.value
)

const highlightedSkillAutocompleteResult = computed(() =>
  filteredSkillAutocompleteResults.value[skillAutocompleteHighlightIndex.value]
  ?? filteredSkillAutocompleteResults.value[0]
  ?? null
)

const slashDropdownOpen = computed(() =>
  !reviewDrawerOpen.value
  && !skillAutocompleteOpen.value
  && !mentionAutocompleteOpen.value
  && Boolean(activeSlashMatch.value)
  && activeSlashMatchKey.value !== dismissedSlashMatchKey.value
  && filteredSlashCommands.value.length > 0
)

const highlightedSlashCommand = computed(() =>
  filteredSlashCommands.value[slashHighlightIndex.value] ?? filteredSlashCommands.value[0] ?? null
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

const mentionAutocompleteEmptyState = computed(() => {
  if (!mentionAutocompleteOpen.value) {
    return null
  }

  if (mentionAutocompleteSections.value.length > 0) {
    return null
  }

  if (pluginMentionLoading.value) {
    return 'Loading mention targets...'
  }

  if (pluginMentionError.value) {
    return pluginMentionError.value
  }

  if (normalizedMentionAutocompleteQuery.value) {
    if (!selectedProject.value?.projectPath) {
      return 'Project runtime is not ready yet.'
    }

    if (fileAutocompleteLoading.value) {
      return 'Searching mention targets...'
    }

    if (fileAutocompleteError.value) {
      return fileAutocompleteError.value
    }

    return 'No matching mentions.'
  }

  return 'No active agents or enabled plugins.'
})

const skillAutocompleteEmptyState = computed(() => {
  if (!skillAutocompleteOpen.value) {
    return null
  }

  if (!selectedProject.value?.projectPath) {
    return 'Project runtime is not ready yet.'
  }

  if (skillAutocompleteLoading.value) {
    return 'Loading available skills...'
  }

  if (skillAutocompleteError.value && filteredSkillAutocompleteResults.value.length === 0) {
    return skillAutocompleteError.value
  }

  if (filteredSkillAutocompleteResults.value.length === 0) {
    return activeSkillAutocompleteMatch.value?.query
      ? 'No matching skills.'
      : 'No available skills were found for this workspace.'
  }

  return null
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
      const client = getRuntimeClient()
      const initialModel = selectedModel.value
      const initialEffort = selectedEffort.value
      let nextModels = availableModels.value.length > 0 ? availableModels.value : FALLBACK_MODELS
      let defaultModel: string | null = null
      let defaultEffort: ReasoningEffort | null = null

      const [modelsResponse, configResponse] = await Promise.allSettled([
        client.request<ModelListResponse>('model/list'),
        client.request<ConfigReadResponse>('config/read', {
          includeLayers: false,
          cwd: selectedProject.value?.projectPath ?? null
        } satisfies ConfigReadParams)
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

const optimisticAttachmentSnapshots = new Map<string, DraftAttachment[]>()
let promptControlsPromise: Promise<void> | null = null
let pendingThreadHydration: Promise<void> | null = null
let releaseServerRequestHandler: (() => void) | null = null
let releaseSkillNotificationSubscription: (() => void) | null = null
let releaseWorkspaceGitBranchEnvironmentListeners: (() => void) | null = null
let footerResizeObserver: ResizeObserver | null = null
let skipNextSkillMentionSync = false
let skipNextMentionSelectionSync = false
let skillAutocompleteRequestSequence = 0
let pluginMentionRequestSequence = 0
let fileAutocompleteRequestSequence = 0

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
  !currentThreadCollaborationModeMask.value
  && shouldSubmitViaTurnSteer({
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

const subscribeThreadNotifications = (threadId: string, liveStream: LiveStream) => {
  const client = getRuntimeClient()
  liveStream.unsubscribe = client.subscribe((notification) => {
    const targetThreadId = notificationThreadId(notification)
    if (!targetThreadId) {
      return
    }

    if (targetThreadId && targetThreadId !== threadId) {
      if (liveStream.observedSubagentThreadIds.has(targetThreadId)) {
        applySubagentNotification(targetThreadId, notification)
      }
      return
    }

    if (!liveStream.turnId) {
      liveStream.bufferedNotifications.push(notification)
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
}

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
    const buffered: CodexRpcNotification[] = []
    clearLiveStream()

    const liveStream = createLiveStreamState(threadId, buffered)
    subscribeThreadNotifications(threadId, liveStream)

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

const ensureObservedThreadSubscription = async () => {
  if (session.liveStream && session.liveStream.threadId === activeThreadId.value) {
    return session.liveStream
  }

  const threadId = activeThreadId.value
  if (!threadId) {
    return null
  }

  await ensureProjectRuntime()
  const liveStream = createLiveStreamState(threadId)
  subscribeThreadNotifications(threadId, liveStream)
  setSessionLiveStream(liveStream)
  return liveStream
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

const updateThreadTitleFromUserInput = (threadId: string, text: string) => {
  const nextTitle = normalizeThreadTitleCandidate(text)
  if (!nextTitle) {
    return
  }

  const fallbackTitle = `Thread ${threadId}`
  if (!threadTitle.value || threadTitle.value === fallbackTitle) {
    threadTitle.value = nextTitle
  }

  updateThreadSummaryTitle(threadId, nextTitle)
}

const syncChatSessionTitle = (title: string) => {
  if (!isChatSessionWorkspace.value) {
    return
  }

  void renameChat(workspaceId, title).catch(() => {
    // Keep the live UI responsive even if marker persistence fails.
  })
}

const syncChatSessionTitleFromThreadName = (thread: { name: string | null }) => {
  const nextTitle = normalizeThreadTitleCandidate(thread.name)
  if (nextTitle) {
    syncChatSessionTitle(nextTitle)
  }
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

  if (!activeSkillAutocompleteMatchKey.value || activeSkillAutocompleteMatchKey.value !== dismissedSkillAutocompleteMatchKey.value) {
    dismissedSkillAutocompleteMatchKey.value = null
  }

  if (!activeMentionAutocompleteMatchKey.value || activeMentionAutocompleteMatchKey.value !== dismissedMentionAutocompleteMatchKey.value) {
    dismissedMentionAutocompleteMatchKey.value = null
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
  || isFocusWithinContainer(nextFocused, skillAutocompleteDropdownRef.value)
  || isFocusWithinContainer(nextFocused, mentionAutocompleteDropdownRef.value)

const handlePromptBlur = (event: FocusEvent) => {
  // Composer suggestion popups must stay focusless. If focus ever moves into
  // the overlay, the textarea selection state no longer matches the active
  // token and the menu collapses while the draft still contains `/` or `@`.
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

const handleSkillAutocompletePointerDown = (event: PointerEvent) => {
  event.preventDefault()
  void focusPromptAt(promptSelectionStart.value)
}

const handleMentionAutocompletePointerDown = (event: PointerEvent) => {
  // Mention suggestions follow the same inert-overlay rule as slash commands.
  // Keeping focus anchored in the textarea avoids collapsing the popup while
  // the active `@token` is still being edited.
  event.preventDefault()
  void focusPromptAt(promptSelectionStart.value)
}

const onPromptEnterCapture = (event: KeyboardEvent) => {
  if (mentionAutocompleteOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const item = highlightedMentionAutocompleteItem.value
    if (item) {
      void selectMentionAutocompleteItem(item)
    }
    return
  }

  if (skillAutocompleteOpen.value) {
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation()

    const skill = highlightedSkillAutocompleteResult.value
    if (skill) {
      void selectSkillAutocompleteResult(skill)
    }
    return
  }

}

const setComposerError = (messageText: string) => {
  markAwaitingAssistantOutput(false)
  error.value = messageText
  status.value = 'error'
}

const clearSlashCommandDraft = () => {
  // Successful slash commands consume the draft immediately. Leaving `/usage`
  // or `/review` in the prompt after opening the modal/drawer makes the next
  // edit start from stale command text and feels like the action did not finish.
  input.value = ''
  insertedSkillMentions.value = []
  insertedMentionSelections.value = []
  clearAttachments({ revoke: false })
  dismissedSlashMatchKey.value = null
}

const cloneSkillMentions = (mentions = insertedSkillMentions.value) =>
  mentions.map(mention => ({ ...mention }))

const cloneMentionSelections = (selections = insertedMentionSelections.value) =>
  selections.map(selection => ({ ...selection }))

const applyDraftTextState = (
  nextText: string,
  nextMentions: SkillAutocompleteSelection[] = [],
  nextMentionSelections: MentionAutocompleteSelection[] = []
) => {
  skipNextSkillMentionSync = true
  skipNextMentionSelectionSync = true
  input.value = nextText
  insertedSkillMentions.value = cloneSkillMentions(nextMentions)
  insertedMentionSelections.value = cloneMentionSelections(nextMentionSelections)
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

const moveSkillAutocompleteHighlight = (delta: number) => {
  if (!filteredSkillAutocompleteResults.value.length) {
    skillAutocompleteHighlightIndex.value = 0
    return
  }

  const maxIndex = filteredSkillAutocompleteResults.value.length - 1
  const nextIndex = skillAutocompleteHighlightIndex.value + delta
  if (nextIndex < 0) {
    skillAutocompleteHighlightIndex.value = maxIndex
    return
  }

  if (nextIndex > maxIndex) {
    skillAutocompleteHighlightIndex.value = 0
    return
  }

  skillAutocompleteHighlightIndex.value = nextIndex
}

const moveMentionAutocompleteHighlight = (delta: number) => {
  if (!flatMentionAutocompleteItems.value.length) {
    mentionAutocompleteHighlightIndex.value = 0
    mentionAutocompleteUserNavigated.value = false
    return
  }

  mentionAutocompleteUserNavigated.value = true
  const maxIndex = flatMentionAutocompleteItems.value.length - 1
  const nextIndex = effectiveMentionAutocompleteHighlightIndex.value + delta
  if (nextIndex < 0) {
    mentionAutocompleteHighlightIndex.value = maxIndex
    return
  }

  if (nextIndex > maxIndex) {
    mentionAutocompleteHighlightIndex.value = 0
    return
  }

  mentionAutocompleteHighlightIndex.value = nextIndex
}

const resolveSlashCommandIcon = (command: SlashCommandDefinition) => {
  if (command.name === 'plan') {
    return 'i-lucide-list-checks'
  }

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

const resolveSkillAutocompleteDescription = (skill: SkillAutocompleteEntry) =>
  skill.shortDescription ?? skill.description

const resolveSkillAutocompleteLabel = (skill: SkillAutocompleteEntry) =>
  skill.displayName?.trim() || skill.name

const resolveAgentMentionDescription = (agent: AgentMentionAutocompleteEntry) => {
  const parts = [
    agent.role,
    agent.status ? agent.status.replace(/^pendingInit$/u, 'pending') : null
  ].filter((value): value is string => Boolean(value))

  return parts.length > 0 ? parts.join(' · ') : null
}

const resolvePluginMentionLabel = (plugin: PluginMentionAutocompleteEntry) =>
  plugin.displayName?.trim() || plugin.name

const resolvePluginMentionAvatarText = (plugin: PluginMentionAutocompleteEntry) => {
  const normalized = resolvePluginMentionLabel(plugin).replace(/\s+/gu, '').trim()
  return Array.from(normalized || 'PL').slice(0, 2).join('').toUpperCase()
}

const resolvePluginMentionAvatarSrc = (plugin: PluginMentionAutocompleteEntry) =>
  resolvePluginMentionIconUrl({
    workspace: workspaceScope,
    path: plugin.composerIcon ?? plugin.logo,
    configuredBase: String(runtimeConfig.public.serverBase ?? '')
  })

const resolvePluginMentionPath = (plugin: PluginMentionAutocompleteEntry) =>
  `plugin://${plugin.name}@${plugin.marketplaceName}`

const resolveSkillAutocompleteIcon = (skill: SkillAutocompleteEntry) => {
  const haystack = [
    skill.name,
    skill.displayName,
    skill.shortDescription,
    skill.description,
    skill.path
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase()

  if (haystack.includes('github') || haystack.includes('gh-') || /\bci\b/.test(haystack) || haystack.includes('actions')) {
    return 'i-lucide-github'
  }

  if (haystack.includes('image') || haystack.includes('figma') || haystack.includes('bitmap')) {
    return 'i-lucide-image'
  }

  if (haystack.includes('calendar') || haystack.includes('schedule')) {
    return 'i-lucide-calendar'
  }

  if (haystack.includes('gmail') || haystack.includes('email') || haystack.includes('mailbox')) {
    return 'i-lucide-mail'
  }

  if (haystack.includes('slack')) {
    return 'i-lucide-message-square'
  }

  if (haystack.includes('excel') || haystack.includes('sheet') || haystack.includes('csv') || haystack.includes('spreadsheet')) {
    return 'i-lucide-table-properties'
  }

  if (haystack.includes('powerpoint') || haystack.includes('slide') || haystack.includes('presentation') || haystack.includes('canva')) {
    return 'i-lucide-presentation'
  }

  if (haystack.includes('cloudflare') || haystack.includes('worker')) {
    return 'i-lucide-cloud'
  }

  if (haystack.includes('plugin')) {
    return 'i-lucide-plug'
  }

  return 'i-lucide-badge-plus'
}

const selectSkillAutocompleteResult = async (skill: SkillAutocompleteEntry) => {
  const activeMatch = activeSkillAutocompleteMatch.value
  if (!activeMatch) {
    return
  }

  dismissedSkillAutocompleteMatchKey.value = null
  skillAutocompleteError.value = null
  const completion = toSkillAutocompleteCompletion(skill)
  const nextDraft = replaceActiveSkillAutocompleteMatch(input.value, activeMatch, completion)
  const nextMentions = reconcileSkillAutocompleteSelections(
    input.value,
    nextDraft.value,
    insertedSkillMentions.value
  )
  const nextMentionSelections = reconcileMentionAutocompleteSelections(
    input.value,
    nextDraft.value,
    insertedMentionSelections.value
  )

  nextMentions.push({
    start: nextDraft.tokenStart,
    end: nextDraft.tokenEnd,
    name: skill.name,
    path: skill.path
  })

  applyDraftTextState(nextDraft.value, nextMentions, nextMentionSelections)
  await focusPromptAt(nextDraft.caret)
}

const resolveFileAutocompleteIcon = (match: Pick<NormalizedFuzzyFileSearchMatch, 'matchType'>) =>
  match.matchType === 'directory' ? 'i-lucide-folder-open' : 'i-lucide-file-code-2'

const renderFileAutocompletePathSegments = (
  match: Pick<NormalizedFuzzyFileSearchMatch, 'path' | 'indices'>
): FileAutocompletePathSegment[] =>
  buildFileAutocompletePathSegments(match)

const selectAgentMentionEntry = async (agent: AgentMentionAutocompleteEntry) => {
  const activeMatch = activeMentionAutocompleteMatch.value
  if (!activeMatch) {
    return
  }

  dismissedMentionAutocompleteMatchKey.value = null
  fileAutocompleteError.value = null
  const replacement = toAgentMentionToken(agent)
  const nextDraft = replaceActiveMentionAutocompleteMatch(input.value, activeMatch, replacement)
  const nextSkillMentions = reconcileSkillAutocompleteSelections(
    input.value,
    nextDraft.value,
    insertedSkillMentions.value
  )
  const nextMentionSelections = reconcileMentionAutocompleteSelections(
    input.value,
    nextDraft.value,
    insertedMentionSelections.value
  )

  nextMentionSelections.push({
    start: nextDraft.tokenStart,
    end: nextDraft.tokenEnd,
    kind: 'agent',
    token: replacement,
    name: agent.name,
    threadId: agent.threadId
  })

  applyDraftTextState(nextDraft.value, nextSkillMentions, nextMentionSelections)
  await focusPromptAt(nextDraft.caret)
}

const selectPluginMentionEntry = async (plugin: PluginMentionAutocompleteEntry) => {
  const activeMatch = activeMentionAutocompleteMatch.value
  if (!activeMatch) {
    return
  }

  dismissedMentionAutocompleteMatchKey.value = null
  fileAutocompleteError.value = null
  const replacement = toPluginMentionToken(plugin)
  const nextDraft = replaceActiveMentionAutocompleteMatch(input.value, activeMatch, replacement)
  const nextSkillMentions = reconcileSkillAutocompleteSelections(
    input.value,
    nextDraft.value,
    insertedSkillMentions.value
  )
  const nextMentionSelections = reconcileMentionAutocompleteSelections(
    input.value,
    nextDraft.value,
    insertedMentionSelections.value
  )

  nextMentionSelections.push({
    start: nextDraft.tokenStart,
    end: nextDraft.tokenEnd,
    kind: 'plugin',
    token: replacement,
    name: resolvePluginMentionLabel(plugin),
    path: resolvePluginMentionPath(plugin)
  })

  applyDraftTextState(nextDraft.value, nextSkillMentions, nextMentionSelections)
  await focusPromptAt(nextDraft.caret)
}

const selectFileAutocompleteResult = async (match: NormalizedFuzzyFileSearchMatch) => {
  const activeMatch = activeMentionAutocompleteMatch.value
  if (!activeMatch) {
    return
  }

  dismissedMentionAutocompleteMatchKey.value = null
  fileAutocompleteError.value = null
  const replacement = toFileAutocompleteHandle(match)
  const nextDraft = replaceActiveFileAutocompleteMatch(input.value, activeMatch, replacement)
  const nextSkillMentions = reconcileSkillAutocompleteSelections(
    input.value,
    nextDraft.value,
    insertedSkillMentions.value
  )
  const nextMentionSelections = reconcileMentionAutocompleteSelections(
    input.value,
    nextDraft.value,
    insertedMentionSelections.value
  )

  applyDraftTextState(nextDraft.value, nextSkillMentions, nextMentionSelections)
  fileAutocompleteResults.value = []
  await focusPromptAt(nextDraft.caret)
}

const selectMentionAutocompleteItem = async (item: MentionAutocompletePaletteItem) => {
  if (item.kind === 'agent') {
    await selectAgentMentionEntry(item.agent)
    return
  }

  if (item.kind === 'plugin') {
    await selectPluginMentionEntry(item.plugin)
    return
  }

  await selectFileAutocompleteResult(item.file)
}

const syncMentionAutocompleteScroll = async () => {
  await nextTick()

  const selected = mentionAutocompleteListRef.value?.querySelector<HTMLElement>(
    '[data-mention-autocomplete-option][aria-selected="true"]'
  )
  selected?.scrollIntoView({
    block: 'nearest'
  })
}

const resolveMentionAutocompleteIndex = (item: MentionAutocompletePaletteItem) =>
  flatMentionAutocompleteItems.value.findIndex(candidate => candidate.key === item.key)

const syncSkillAutocompleteScroll = async () => {
  await nextTick()

  const selected = skillAutocompleteListRef.value?.querySelector<HTMLElement>(
    '[data-skill-autocomplete-option][aria-selected="true"]'
  )
  selected?.scrollIntoView({
    block: 'nearest'
  })
}

const shouldReloadPluginMentionCatalog = (projectPath: string) =>
  pluginMentionCatalogCwd.value !== projectPath

const loadPluginMentionCatalog = async (options?: {
  projectPath?: string | null
  requestSequence?: number | null
}) => {
  const projectPath = options?.projectPath ?? selectedProject.value?.projectPath ?? null
  if (!projectPath) {
    pluginMentionCatalog.value = []
    pluginMentionCatalogCwd.value = null
    pluginMentionError.value = null
    return []
  }

  await ensureProjectRuntime()
  const response = await getRuntimeClient().request('plugin/list', {
    cwds: [projectPath]
  })
  const plugins = normalizePluginListResponse(response)

  if (options?.requestSequence != null && options.requestSequence !== pluginMentionRequestSequence) {
    return pluginMentionCatalog.value
  }

  pluginMentionCatalog.value = plugins
  pluginMentionCatalogCwd.value = projectPath
  pluginMentionError.value = null
  return plugins
}

const shouldReloadSkillAutocompleteCatalog = (projectPath: string) =>
  skillAutocompleteCatalogCwd.value !== projectPath
  || skillAutocompleteCatalogVersion.value !== skillAutocompleteInvalidationVersion.value

const isLatestSkillAutocompleteRequest = (requestSequence?: number | null) =>
  requestSequence == null || requestSequence === skillAutocompleteRequestSequence

const loadSkillAutocompleteCatalog = async (options?: {
  forceReload?: boolean
  projectPath?: string | null
  requestSequence?: number | null
}) => {
  const projectPath = options?.projectPath ?? selectedProject.value?.projectPath ?? null
  if (!projectPath) {
    skillAutocompleteCatalog.value = []
    skillAutocompleteCatalogCwd.value = null
    skillAutocompleteCatalogVersion.value = -1
    skillAutocompleteError.value = null
    return []
  }

  await ensureProjectRuntime()
  const response = await getRuntimeClient().request('skills/list', {
    cwds: [projectPath],
    forceReload: options?.forceReload ? true : undefined
  })

  const entries = normalizeSkillsListResponse(response)
  const entry = entries.find(candidate => candidate.cwd === projectPath) ?? entries[0] ?? null
  const skills = entry?.skills.filter(skill => skill.enabled) ?? []
  const nextError = skills.length === 0 && entry?.errors.length
    ? entry.errors.map(errorEntry => errorEntry.message).join('\n')
    : null

  if (!isLatestSkillAutocompleteRequest(options?.requestSequence)) {
    return skillAutocompleteCatalog.value
  }

  skillAutocompleteCatalog.value = skills
  skillAutocompleteCatalogCwd.value = projectPath
  skillAutocompleteCatalogVersion.value = skillAutocompleteInvalidationVersion.value
  skillAutocompleteError.value = nextError

  return skills
}

const ensureSkillAutocompleteCatalogCurrent = async () => {
  const projectPath = selectedProject.value?.projectPath ?? null
  if (!projectPath) {
    return skillAutocompleteCatalog.value
  }

  if (!shouldReloadSkillAutocompleteCatalog(projectPath)) {
    return skillAutocompleteCatalog.value
  }

  const requestSequence = ++skillAutocompleteRequestSequence
  return await loadSkillAutocompleteCatalog({
    forceReload: skillAutocompleteCatalogCwd.value === projectPath,
    projectPath,
    requestSequence
  })
}

type SlashCommandSubmissionResult = {
  consumed: boolean
  replacementText?: string
}

const handleSlashCommandSubmission = async (
  rawText: string,
  submittedAttachments: DraftAttachment[]
): Promise<SlashCommandSubmissionResult> => {
  const slashCommand = parseSubmittedSlashCommand(rawText)
  if (!slashCommand) {
    return {
      consumed: false
    }
  }

  if (!slashCommands.value.some(candidate => candidate.name === slashCommand.name)) {
    return {
      consumed: false
    }
  }

  const dispatchAction = resolveSlashCommandDispatch({
    slashCommand,
    attachmentsCount: submittedAttachments.length,
    planModeAvailable: Boolean(planCollaborationModeMask.value) || !collaborationModesLoaded.value,
    planModeUnavailableMessage: collaborationModesError.value
  })

  switch (dispatchAction.type) {
    case 'passThrough':
      return {
        consumed: false
      }
    case 'error':
      setComposerError(dispatchAction.message)
      return {
        consumed: true
      }
    case 'openReview':
      error.value = null
      status.value = 'ready'
      clearSlashCommandDraft()
      openReviewDrawer(rawText.trim())
      await focusPromptAt(0)
      return {
        consumed: true
      }
    case 'openUsageStatus':
      error.value = null
      status.value = 'ready'
      clearSlashCommandDraft()
      usageStatusModalOpen.value = true
      return {
        consumed: true
      }
    case 'activatePlanMode':
      try {
        await setCurrentThreadCollaborationMode('plan')
      } catch (caughtError) {
        setComposerError(caughtError instanceof Error ? caughtError.message : String(caughtError))
        return {
          consumed: true
        }
      }

      error.value = null
      status.value = 'ready'
      clearSlashCommandDraft()
      closePlanImplementationPrompt()
      await focusPromptAt(0)
      return {
        consumed: true
      }
    case 'submitPlanPrompt':
      try {
        await ensurePlanModeAvailable()
        setThreadCollaborationModeMask(activeThreadId.value ?? routeThreadId.value, planCollaborationModeMask.value)
      } catch (caughtError) {
        setComposerError(caughtError instanceof Error ? caughtError.message : String(caughtError))
        return {
          consumed: true
        }
      }

      error.value = null
      status.value = 'ready'
      closePlanImplementationPrompt()
      return {
        consumed: false,
        replacementText: dispatchAction.text
      }
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

const handleUsageStatusOpenChange = (open: boolean) => {
  usageStatusModalOpen.value = open
}

const removeOptimisticMessage = (messageId: string) => {
  messages.value = removeChatMessage(messages.value, messageId)
  optimisticAttachmentSnapshots.delete(messageId)
}

const markAwaitingAssistantOutput = (nextValue: boolean) => {
  awaitingAssistantOutput.value = nextValue
}

const markAssistantOutputStartedForItem = (item: ThreadItem) => {
  if (item.type !== 'userMessage') {
    markAwaitingAssistantOutput(false)
  }
}

const restoreDraftIfPristine = (
  text: string,
  submittedAttachments: DraftAttachment[],
  submittedSkillMentions: SkillAutocompleteSelection[] = [],
  submittedMentionSelections: MentionAutocompleteSelection[] = []
) => {
  if (!input.value.trim()) {
    applyDraftTextState(text, submittedSkillMentions, submittedMentionSelections)
  }

  if (attachments.value.length === 0 && submittedAttachments.length > 0) {
    replaceAttachments(submittedAttachments)
  }
}

const reviewWorkflow = useChatReviewWorkflow({
  projectId: workspaceId,
  serverBase: String(runtimeConfig.public.serverBase ?? ''),
  input,
  attachments,
  hasPendingRequest,
  isWorkflowBusy,
  supportsGit: supportsWorkspaceGit,
  error,
  status,
  tokenUsage,
  messages,
  setComposerError,
  markAwaitingAssistantOutput,
  clearAttachments,
  restoreDraftIfPristine: (text, submittedAttachments) =>
    restoreDraftIfPristine(text, submittedAttachments),
  ensurePendingLiveStream,
  getClient: () => getRuntimeClient(),
  lockLiveStreamTurnId,
  replayBufferedNotifications,
  clearDismissedSlashMatch: () => {
    dismissedSlashMatchKey.value = null
  }
})

const {
  reviewDrawerOpen,
  reviewDrawerMode,
  reviewBaseBranches,
  reviewCurrentBranch,
  reviewBranchesLoading,
  reviewBranchesError,
  reviewStartPending,
  openReviewDrawer,
  openBaseBranchPicker,
  startReview,
  handleReviewDrawerOpenChange,
  handleReviewDrawerBack
} = reviewWorkflow

const planWorkflow = useChatPlanWorkflow({
  projectId: workspaceId,
  routeThreadId,
  activeThreadId,
  hasPendingRequest,
  isBusy: computed(() => isWorkflowBusy.value || reviewStartPending.value),
  selectedProjectStatus: computed(() => selectedProject.value?.status ?? null),
  selectedModel,
  selectedEffort,
  threadPlans,
  threadCollaborationModeMasks,
  collaborationModeMasks,
  collaborationModesLoaded,
  collaborationModesLoading,
  collaborationModesError,
  latestPlanTurnId,
  queuedPlanImplementationPromptTurnId,
  queuedPlanImplementationPromptThreadId,
  planImplementationPromptTurnId,
  planImplementationPromptThreadId,
  shownPlanImplementationPromptTurnIds: session.shownPlanImplementationPromptTurnIds,
  ensureProjectRuntime,
  getClient: () => getRuntimeClient()
})

const {
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
  ensurePlanModeAvailable,
  setCurrentThreadCollaborationMode,
  closePlanImplementationPrompt,
  maybeQueuePlanImplementationPrompt
} = planWorkflow

const subagentPanelsController = useSubagentPanelsController({
  projectId: workspaceId,
  subagentPanels,
  ensureProjectRuntime,
  getClient: () => getRuntimeClient(),
  isActiveTurnStatus,
  currentLiveStream
})

const {
  getSubagentPanel,
  createSubagentPanelState,
  upsertSubagentPanel,
  rememberObservedSubagentThread,
  bootstrapSubagentPanel,
  applySubagentActivityItem,
  rebuildSubagentPanelsFromThread,
  applySubagentNotification
} = subagentPanelsController

const isBusy = computed(() =>
  isWorkflowBusy.value
  || reviewStartPending.value
)
const isWorkspaceBranchControlDisabled = computed(() =>
  hasPendingRequest.value
  || isBusy.value
  || sendMessageLocked.value
)

const refreshWorkspaceGitBranchesInBackground = (activity: string) => {
  void refreshWorkspaceGitBranchesForActivity(activity)
}

const refreshWorkspaceGitBranchesFromEnvironment = (signal: string) => {
  if (!import.meta.client || document.visibilityState !== 'visible') {
    return
  }

  void refreshWorkspaceGitBranchesForEnvironmentSignal(signal)
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
  client: ReturnType<typeof getRuntimeClient>
  liveStream: LiveStream
  text: string
  submittedAttachments: DraftAttachment[]
  additionalInput?: ReturnType<typeof buildMentionAutocompleteSubmission>['pluginInput']
  collaborationMode?: CollaborationMode | null
  uploadedAttachments?: PersistedProjectAttachment[]
  optimisticMessageId: string
  queueOptimisticMessage?: boolean
}) => {
  const {
    client,
    liveStream,
    text,
    submittedAttachments,
    additionalInput = [],
    collaborationMode = null,
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
    input: buildTurnStartInput(text, uploadedAttachments, additionalInput),
    cwd: selectedProject.value?.projectPath ?? null,
    approvalPolicy: 'never',
    collaborationMode,
    ...buildTurnOverrides(selectedModel.value, selectedEffort.value)
  })

  tokenUsage.value = null
  setLiveStreamTurnId(liveStream, turnStart.turn.id)
  replayBufferedNotifications(liveStream)
}

const sendMentionedAgentMessage = async (input: {
  threadId: string
  text: string
  submittedAttachments: DraftAttachment[]
  additionalInput: ReturnType<typeof buildMentionAutocompleteSubmission>['pluginInput']
}) => {
  const client = getRuntimeClient()
  const { threadId, text, submittedAttachments, additionalInput } = input

  await ensureObservedThreadSubscription()
  await bootstrapSubagentPanel(threadId)
  rememberObservedSubagentThread(threadId)
  const uploadedAttachments = await uploadAttachments(threadId, submittedAttachments)
  const currentTurnId = getSubagentPanel(threadId)?.turnId ?? null

  if (currentTurnId) {
    try {
      await client.request<TurnStartResponse>('turn/steer', {
        threadId,
        expectedTurnId: currentTurnId,
        input: buildTurnStartInput(text, uploadedAttachments, additionalInput),
        ...buildTurnOverrides(selectedModel.value, selectedEffort.value)
      })
      return
    } catch (caughtError) {
      const errorToHandle = caughtError instanceof Error ? caughtError : new Error(String(caughtError))
      if (!shouldRetrySteerWithTurnStart(errorToHandle.message)) {
        throw errorToHandle
      }
    }
  }

  const turnStart = await client.request<TurnStartResponse>('turn/start', {
    threadId,
    input: buildTurnStartInput(text, uploadedAttachments, additionalInput),
    cwd: selectedProject.value?.projectPath ?? null,
    approvalPolicy: 'never',
    ...buildTurnOverrides(selectedModel.value, selectedEffort.value)
  })

  upsertSubagentPanel(threadId, (panel) => ({
    ...(panel ?? createSubagentPanelState(threadId)),
    turnId: turnStart.turn.id,
    status: 'running',
    bootstrapped: panel?.bootstrapped ?? true,
    lastSeenAt: Date.now()
  }))
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

async function ensureProjectRuntime() {
  if (workspaceKind === 'chat') {
    if (!chatsLoaded.value) {
      await refreshChats()
    }
    if (selectedProject.value?.status === 'running') {
      return
    }
    await startChat(workspaceId)
    return
  }

  if (!loaded.value) {
    await refreshProjects()
  }
  if (selectedProject.value?.status === 'running') {
    return
  }

  await startProject(workspaceId)
}

const hydrateThread = async (threadId: string) => {
  const hydratePromise = (async () => {
    const requestVersion = loadVersion.value + 1
    loadVersion.value = requestVersion
    error.value = null
    tokenUsage.value = null
    latestPlanTurnId.value = null

    try {
      await ensureProjectRuntime()
      const client = getRuntimeClient()
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

          if (targetThreadId && targetThreadId !== threadId) {
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
      refreshWorkspaceGitBranchesInBackground('thread/resume')
      activeThreadId.value = response.thread.id
      threadTitle.value = resolveThreadSummaryTitle(response.thread)
      syncThreadSummary(response.thread)
      syncChatSessionTitleFromThreadName(response.thread)
      messages.value = threadToMessages(response.thread)
      latestPlanTurnId.value = findLatestPlanTurnId(response.thread.turns)
      maybeQueuePlanImplementationPrompt({
        threadId: response.thread.id,
        turnId: findLatestCompletedPlanTurnId(response.thread.turns),
        turnStatus: 'completed'
      })
      rebuildSubagentPanelsFromThread(response.thread)
      markAwaitingAssistantOutput(false)
      const activeTurn = [...response.thread.turns].reverse().find(turn => isActiveTurnStatus(turn.status))
      const liveStream = session.liveStream

      if (liveStream) {
        const bufferedTurnId = activeTurn?.id
          ?? liveStream.bufferedNotifications
            .map(notificationTurnId)
            .find((turnId): turnId is string => Boolean(turnId))

        if (bufferedTurnId) {
          setLiveStreamTurnId(liveStream, bufferedTurnId)
        }

        replayBufferedNotifications(liveStream)
      }

      if (!activeTurn) {
        clearLiveStream()
        if (!error.value) {
          status.value = 'ready'
        }
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
  latestPlanTurnId.value = null
  closePlanImplementationPrompt()
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
  const client = getRuntimeClient()
  const response = await client.request<ThreadStartResponse>('thread/start', {
    cwd: selectedProject.value?.projectPath ?? null,
    approvalPolicy: 'never',
    experimentalRawEvents: false,
    persistExtendedHistory: true
  })

  activeThreadId.value = response.thread.id
  if (workspaceKind === 'chat') {
    void setChatThread(workspaceId, response.thread.id).catch(() => {})
  }
  refreshWorkspaceGitBranchesInBackground('thread/start')
  moveDraftCollaborationModeToThread(response.thread.id)
  threadTitle.value = resolveThreadSummaryTitle(response.thread)
  syncThreadSummary(response.thread)
  syncChatSessionTitleFromThreadName(response.thread)
  return {
    threadId: response.thread.id,
    created: true
  }
}

const seedStreamingMessage = (item: ThreadItem) => {
  const [seed] = itemToMessages(item, {
    webSearchStatus: item.type === 'webSearch' ? 'inProgress' : undefined
  })
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

const appendPlanPartDelta = (
  messageId: string,
  delta: string,
  fallbackMessage: ChatMessage
) => {
  updateMessage(messageId, fallbackMessage, (message) => {
    const partIndex = message.parts.findIndex(part => part.type === 'plan')
    const existingPlanPart = partIndex === -1 ? null : message.parts[partIndex] as Extract<ChatPart, { type: 'plan' }>
    const nextText = existingPlanPart ? `${existingPlanPart.text}${delta}` : delta
    const nextPlanPart: Extract<ChatPart, { type: 'plan' }> = {
      type: 'plan',
      text: nextText,
      state: 'streaming'
    }
    const nextParts = partIndex === -1
      ? [...message.parts, nextPlanPart]
      : message.parts.map((part, index) => index === partIndex ? nextPlanPart : part)

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
        cwd: '',
        processId: null,
        source: 'agent',
        commandActions: [],
        aggregatedOutput: '',
        exitCode: null,
        status: 'inProgress',
        durationMs: null
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
        status: 'inProgress'
      },
      liveOutput: ''
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
        durationMs: null
      },
      progressMessages: []
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

const updateWebSearchMessageStatus = (
  chatMessages: ChatMessage[],
  status: WebSearchStatus
) => chatMessages.map((message) => {
  const partIndex = message.parts.findIndex(isItemPart)
  if (partIndex === -1) {
    return message
  }

  const itemPart = message.parts[partIndex] as Extract<ChatPart, { type: typeof ITEM_PART }>
  if (itemPart.data.kind !== 'web_search') {
    return message
  }
  if (!message.pending && itemPart.data.status !== 'inProgress') {
    return message
  }

  const nextPart: Extract<ChatPart, { type: typeof ITEM_PART }> = {
    ...itemPart,
    data: {
      ...itemPart.data,
      status
    }
  }

  return {
    ...message,
    pending: status === 'inProgress',
    parts: message.parts.map((part, index) => index === partIndex ? nextPart : part)
  }
})

const applyTurnStartedNotification = (
  notification: CodexRpcNotification,
  liveStream: LiveStream | null
) => {
  const threadId = notificationThreadId(notification) ?? currentLiveStream()?.threadId ?? activeThreadId.value
  const nextTurnId = notificationTurnId(notification)
  if (liveStream && !shouldAdvanceLiveStreamTurn({
    lockedTurnId: liveStream.lockedTurnId,
    nextTurnId
  })) {
    return
  }

  if (threadId && shouldResetThreadPlanForTurn(threadId, nextTurnId)) {
    clearThreadPlanState(threadId)
  }

  if (nextTurnId) {
    latestPlanTurnId.value = null
  }
  closePlanImplementationPrompt()

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
}

const applyItemStartedNotification = (notification: CodexRpcNotification) => {
  const params = notification.params as { item: ThreadItem }
  if (params.item.type === 'collabAgentToolCall') {
    applySubagentActivityItem(params.item)
  }
  if (params.item.type === 'plan') {
    latestPlanTurnId.value = notificationTurnId(notification) ?? currentLiveStream()?.turnId ?? null
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
}

const applyItemCompletedNotification = (notification: CodexRpcNotification) => {
  const params = notification.params as { item: ThreadItem }
  if (params.item.type === 'collabAgentToolCall') {
    applySubagentActivityItem(params.item)
  }
  if (params.item.type === 'plan') {
    latestPlanTurnId.value = notificationTurnId(notification) ?? currentLiveStream()?.turnId ?? null
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
}

const applyTerminalNotification = (
  kind: 'turn.failed' | 'stream.error',
  messageText: string,
  liveStream: LiveStream | null
) => {
  markAwaitingAssistantOutput(false)
  pushEventMessage(kind, messageText)
  clearPendingOptimisticMessages(liveStream, { discardSnapshots: true })
  if (liveStream) {
    liveStream.lockedTurnId = null
  }
  clearLiveStream(new Error(messageText))
  error.value = messageText
  status.value = 'error'
}

const applyTurnCompletedNotification = (
  notification: CodexRpcNotification,
  liveStream: LiveStream | null
) => {
  if (notificationTurnStatus(notification) === 'failed') {
    messages.value = updateWebSearchMessageStatus(messages.value, 'failed')
  }
  maybeQueuePlanImplementationPrompt({
    threadId: notificationThreadId(notification) ?? liveStream?.threadId ?? activeThreadId.value,
    turnId: notificationTurnId(notification) ?? liveStream?.turnId ?? null,
    turnStatus: notificationTurnStatus(notification)
  })
  markAwaitingAssistantOutput(false)
  clearPendingOptimisticMessages(liveStream, { discardSnapshots: true })
  if (liveStream) {
    liveStream.lockedTurnId = null
  }
  error.value = null
  status.value = 'ready'
  clearLiveStream()
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
      refreshWorkspaceGitBranchesInBackground('thread/start')
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
        syncChatSessionTitle(nextTitle)
      }

      updateThreadSummaryTitle(nextThreadId, nextTitle, notificationThreadUpdatedAt(notification))
      return
    }
    case 'serverRequest/resolved': {
      const requestId = notificationRequestId(notification)
      if (requestId == null) {
        return
      }

      markRequestResolved(requestId, notificationThreadId(notification))
      return
    }
    case 'turn/started': {
      refreshWorkspaceGitBranchesInBackground('turn/start')
      applyTurnStartedNotification(notification, liveStream)
      return
    }
    case 'item/started': {
      refreshWorkspaceGitBranchesInBackground('item/start')
      applyItemStartedNotification(notification)
      return
    }
    case 'item/completed': {
      refreshWorkspaceGitBranchesInBackground('item/completed')
      applyItemCompletedNotification(notification)
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
      latestPlanTurnId.value = notificationTurnId(notification) ?? currentLiveStream()?.turnId ?? null
      markAwaitingAssistantOutput(false)
      appendPlanPartDelta(params.itemId, params.delta, {
        id: params.itemId,
        role: 'assistant',
        pending: true,
        parts: [{
          type: 'plan',
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
        const liveOutput = itemData.kind === 'file_change'
          ? itemData.liveOutput
          : fallbackItem.liveOutput
        return {
          kind: 'file_change',
          item: {
            ...baseItem,
            status: 'inProgress'
          },
          liveOutput: `${liveOutput ?? ''}${params.delta}`
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
        const progressMessages = itemData.kind === 'mcp_tool_call'
          ? itemData.progressMessages
          : fallbackItem.progressMessages
        return {
          kind: 'mcp_tool_call',
          item: {
            ...baseItem,
            status: 'inProgress'
          },
          progressMessages: [...(progressMessages ?? []), params.message]
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
    case 'turn/plan/updated': {
      const threadId = notificationThreadId(notification) ?? currentLiveStream()?.threadId ?? activeThreadId.value
      if (!threadId) {
        return
      }

      latestPlanTurnId.value = notificationTurnId(notification) ?? currentLiveStream()?.turnId ?? latestPlanTurnId.value
      updateThreadPlanState(threadId, notification.params)
      return
    }
    case 'error': {
      const params = notification.params as { error?: { message?: string } }
      applyTerminalNotification('stream.error', params.error?.message ?? 'The stream failed.', liveStream)
      return
    }
    case 'turn/failed': {
      const params = notification.params as { error?: { message?: string } }
      applyTerminalNotification('turn.failed', params.error?.message ?? 'The turn failed.', liveStream)
      return
    }
    case 'stream/error': {
      const params = notification.params as { message?: string }
      applyTerminalNotification('stream.error', params.message ?? 'The stream failed.', liveStream)
      return
    }
    case 'turn/completed': {
      refreshWorkspaceGitBranchesInBackground('turn/completed')
      applyTurnCompletedNotification(notification, liveStream)
      return
    }
    default:
      return
  }
}

const sendMessage = async () => {
  // Nuxt UI's UChatPrompt emits `submit` directly from its internal
  // `keydown.enter.exact` handler, so guarding only in our keydown callback is
  // not sufficient to stop Enter from racing into a send while the mention palette
  // is open. Keep the submit path itself aware of the palette state.
  if (mentionAutocompleteOpen.value) {
    const item = highlightedMentionAutocompleteItem.value
    if (item) {
      await selectMentionAutocompleteItem(item)
    }

    return
  }

  if (skillAutocompleteOpen.value) {
    const skill = highlightedSkillAutocompleteResult.value
    if (skill) {
      await selectSkillAutocompleteResult(skill)
    }

    return
  }

  if (sendMessageLocked.value || hasPendingRequest.value) {
    return
  }

  sendMessageLocked.value = true
  refreshWorkspaceGitBranchesInBackground('submit')
  const rawText = input.value
  const submittedAttachments = attachments.value.slice()
  let submittedSkillMentions = cloneSkillMentions()
  let submittedMentionSelections = cloneMentionSelections()
  let effectiveRawText = rawText

  if (!effectiveRawText.trim() && submittedAttachments.length === 0) {
    sendMessageLocked.value = false
    return
  }

  const slashResult = await handleSlashCommandSubmission(effectiveRawText, submittedAttachments)
  if (slashResult.consumed) {
    sendMessageLocked.value = false
    return
  }

  const nextEffectiveRawText = slashResult.replacementText ?? effectiveRawText
  if (nextEffectiveRawText !== effectiveRawText) {
    submittedSkillMentions = reconcileSkillAutocompleteSelections(
      effectiveRawText,
      nextEffectiveRawText,
      submittedSkillMentions
    )
    submittedMentionSelections = reconcileMentionAutocompleteSelections(
      effectiveRawText,
      nextEffectiveRawText,
      submittedMentionSelections
    )
  }
  effectiveRawText = nextEffectiveRawText

  if (hasSkillAutocompleteMentions(effectiveRawText)) {
    try {
      await ensureSkillAutocompleteCatalogCurrent()
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
      status.value = 'error'
      sendMessageLocked.value = false
      return
    }
  }

  const submittedMentionInput = buildMentionAutocompleteSubmission(submittedMentionSelections)
  if (submittedMentionInput.agentThreadIds.length > 1) {
    error.value = multiAgentMentionError.value ?? 'Send to one agent at a time.'
    status.value = 'error'
    sendMessageLocked.value = false
    return
  }

  const text = preprocessSkillMentionsForSubmission(
    effectiveRawText,
    submittedSkillMentions,
    skillAutocompleteCatalog.value
  ).trim()
  if (!text && submittedAttachments.length === 0) {
    sendMessageLocked.value = false
    return
  }

  applyDraftTextState('')
  clearAttachments({ revoke: false })

  try {
    await loadPromptControls()
  } catch (caughtError) {
    restoreDraftIfPristine(effectiveRawText, submittedAttachments, submittedSkillMentions, submittedMentionSelections)
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

    const targetAgentThreadId = submittedMentionInput.agentThreadIds[0] ?? null
    if (targetAgentThreadId) {
      await sendMentionedAgentMessage({
        threadId: targetAgentThreadId,
        text,
        submittedAttachments,
        additionalInput: submittedMentionInput.pluginInput
      })
      status.value = 'ready'
      return
    }

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
    const collaborationMode = buildCurrentTurnCollaborationMode()

    try {
      const client = getRuntimeClient()

      if (submissionMethod === 'turn/steer') {
        const liveStream = await ensurePendingLiveStream()
        updateThreadTitleFromUserInput(liveStream.threadId, text)
        queuePendingUserMessage(liveStream, optimisticMessageId)
        let uploadedAttachments: PersistedProjectAttachment[] | undefined

        try {
          uploadedAttachments = await uploadAttachments(liveStream.threadId, submittedAttachments)
          const turnId = await waitForLiveStreamTurnId(liveStream)

          await client.request<TurnStartResponse>('turn/steer', {
            threadId: liveStream.threadId,
            expectedTurnId: turnId,
            input: buildTurnStartInput(text, uploadedAttachments, submittedMentionInput.pluginInput),
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
            additionalInput: submittedMentionInput.pluginInput,
            collaborationMode,
            uploadedAttachments,
            optimisticMessageId,
            queueOptimisticMessage: false
          })
        }
        return
      }

      const liveStream = await ensurePendingLiveStream()
      startedLiveStream = liveStream
      updateThreadTitleFromUserInput(liveStream.threadId, text)
      await submitTurnStart({
        client,
        liveStream,
        text,
        submittedAttachments,
        additionalInput: submittedMentionInput.pluginInput,
        collaborationMode,
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
        restoreDraftIfPristine(effectiveRawText, submittedAttachments, submittedSkillMentions, submittedMentionSelections)
        error.value = messageText
        status.value = 'error'
        return
      }

      restoreDraftIfPristine(effectiveRawText, submittedAttachments, submittedSkillMentions, submittedMentionSelections)
      error.value = messageText
      status.value = 'error'
    }
  } finally {
    sendMessageLocked.value = false
  }
}

const implementCurrentPlan = async () => {
  if (hasDraftContent.value) {
    setComposerError('Clear the current draft before starting plan implementation.')
    return
  }

  try {
    await setCurrentThreadCollaborationMode('default')
  } catch (caughtError) {
    setComposerError(caughtError instanceof Error ? caughtError.message : String(caughtError))
    return
  }

  closePlanImplementationPrompt()
  applyDraftTextState('Implement the plan.')
  await nextTick()
  await sendMessage()
}

const requestPlanRevision = async (prompt: string) => {
  if (hasDraftContent.value) {
    setComposerError('Clear the current draft before requesting a plan update.')
    return
  }

  try {
    await setCurrentThreadCollaborationMode('plan')
  } catch (caughtError) {
    setComposerError(caughtError instanceof Error ? caughtError.message : String(caughtError))
    return
  }

  closePlanImplementationPrompt()
  applyDraftTextState(prompt)
  await nextTick()
  await sendMessage()
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
    const client = getRuntimeClient()
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

const respondToPendingRequest = (payload: { requestId: string | number, response: unknown }) => {
  error.value = null
  if (!resolveRequest(payload.requestId, payload.response)) {
    error.value = 'The pending request could not be matched to the active session.'
  }
}

const onPromptKeydown = (event: KeyboardEvent) => {
  if (mentionAutocompleteOpen.value) {
    if (event.key === 'ArrowDown') {
      if (flatMentionAutocompleteItems.value.length === 0) {
        return
      }

      event.preventDefault()
      moveMentionAutocompleteHighlight(1)
      return
    }

    if (event.key === 'ArrowUp') {
      if (flatMentionAutocompleteItems.value.length === 0) {
        return
      }

      event.preventDefault()
      moveMentionAutocompleteHighlight(-1)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      dismissedMentionAutocompleteMatchKey.value = activeMentionAutocompleteMatchKey.value
      isPromptFocused.value = true
      void focusPromptAt(promptSelectionStart.value)
      return
    }

    if (event.key === 'Tab') {
      const item = highlightedMentionAutocompleteItem.value
      if (!item) {
        return
      }

      event.preventDefault()
      void selectMentionAutocompleteItem(item)
      return
    }
  }

  if (skillAutocompleteOpen.value) {
    if (event.key === 'ArrowDown') {
      if (filteredSkillAutocompleteResults.value.length === 0) {
        return
      }

      event.preventDefault()
      moveSkillAutocompleteHighlight(1)
      return
    }

    if (event.key === 'ArrowUp') {
      if (filteredSkillAutocompleteResults.value.length === 0) {
        return
      }

      event.preventDefault()
      moveSkillAutocompleteHighlight(-1)
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      dismissedSkillAutocompleteMatchKey.value = activeSkillAutocompleteMatchKey.value
      isPromptFocused.value = true
      void focusPromptAt(promptSelectionStart.value)
      return
    }

    if (event.key === 'Tab') {
      const skill = highlightedSkillAutocompleteResult.value
      if (!skill) {
        return
      }

      event.preventDefault()
      void selectSkillAutocompleteResult(skill)
      return
    }
  }

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

  if (mentionAutocompleteOpen.value) {
    event.preventDefault()
    const item = highlightedMentionAutocompleteItem.value
    if (item) {
      void selectMentionAutocompleteItem(item)
    }

    return
  }

  if (skillAutocompleteOpen.value) {
    event.preventDefault()
    const skill = highlightedSkillAutocompleteResult.value
    if (skill) {
      void selectSkillAutocompleteResult(skill)
    }

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
  releaseServerRequestHandler = getRuntimeClient().setServerRequestHandler(handleServerRequest)
  releaseSkillNotificationSubscription = getRuntimeClient().subscribe((notification) => {
    if (notification.method !== 'skills/changed') {
      return
    }

    skillAutocompleteInvalidationVersion.value += 1
  })
  if (!loaded.value) {
    void refreshProjects()
  }
  if (workspaceKind === 'chat' && !chatsLoaded.value) {
    void refreshChats()
  }

  void getRuntimeClient().connect().catch(() => {})
  void loadPromptControls()
  refreshWorkspaceGitBranchesInBackground('mount')
  void scheduleScrollToBottom('auto')

  if (import.meta.client) {
    const handleWorkspaceVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshWorkspaceGitBranchesFromEnvironment('window/visible')
      }
    }
    const handleWorkspaceFocus = () => {
      refreshWorkspaceGitBranchesFromEnvironment('window/focus')
    }
    const handleWorkspaceInteraction = () => {
      refreshWorkspaceGitBranchesFromEnvironment('window/interaction')
    }

    document.addEventListener('visibilitychange', handleWorkspaceVisibilityChange)
    window.addEventListener('focus', handleWorkspaceFocus)
    window.addEventListener('pointermove', handleWorkspaceInteraction, { passive: true })
    window.addEventListener('keydown', handleWorkspaceInteraction)
    releaseWorkspaceGitBranchEnvironmentListeners = () => {
      document.removeEventListener('visibilitychange', handleWorkspaceVisibilityChange)
      window.removeEventListener('focus', handleWorkspaceFocus)
      window.removeEventListener('pointermove', handleWorkspaceInteraction)
      window.removeEventListener('keydown', handleWorkspaceInteraction)
    }

    footerResizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      const borderBoxSize = entry?.borderBoxSize[0]?.blockSize
      const nextHeight = borderBoxSize ?? entry?.target.getBoundingClientRect().height
      if (typeof nextHeight === 'number' && Number.isFinite(nextHeight)) {
        stickyFooterHeight.value = Math.ceil(nextHeight)
      }
    })

    if (stickyFooterRef.value) {
      footerResizeObserver.observe(stickyFooterRef.value)
      stickyFooterHeight.value = Math.ceil(stickyFooterRef.value.getBoundingClientRect().height)
    }
  }
})

onBeforeUnmount(() => {
  releaseServerRequestHandler?.()
  releaseServerRequestHandler = null
  releaseSkillNotificationSubscription?.()
  releaseSkillNotificationSubscription = null
  releaseWorkspaceGitBranchEnvironmentListeners?.()
  releaseWorkspaceGitBranchEnvironmentListeners = null
  footerResizeObserver?.disconnect()
  footerResizeObserver = null
})

watch(() => props.threadId ?? null, (threadId) => {
  refreshWorkspaceGitBranchesInBackground('thread/load')

  if (!threadId) {
    if (isBusy.value || pendingThreadId.value) {
      return
    }

    resetDraftThread()
    if (workspaceKind === 'chat' && props.autoStartThread) {
      void ensureThread()
    }
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
  if (workspaceKind === 'chat') {
    await setChatThread(workspaceId, threadId)
    pendingThreadId.value = null
    autoRedirectThreadId.value = null
    return
  }

  await router.push(toProjectThreadRoute(workspaceId, threadId))
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

watch(filteredSkillAutocompleteResults, (results) => {
  if (!results.length) {
    skillAutocompleteHighlightIndex.value = 0
    return
  }

  if (skillAutocompleteHighlightIndex.value >= results.length) {
    skillAutocompleteHighlightIndex.value = 0
  }
}, { flush: 'sync' })

watch(flatMentionAutocompleteItems, (items) => {
  if (!items.length) {
    mentionAutocompleteHighlightIndex.value = 0
    mentionAutocompleteUserNavigated.value = false
    return
  }

  if (mentionAutocompleteHighlightIndex.value >= items.length) {
    mentionAutocompleteHighlightIndex.value = 0
    mentionAutocompleteUserNavigated.value = false
  }
}, { flush: 'sync' })

watch(
  [mentionAutocompleteOpen, effectiveMentionAutocompleteHighlightIndex, flatMentionAutocompleteItems],
  async ([open, highlightIndex, items]) => {
    if (!open || !items.length || highlightIndex >= items.length) {
      return
    }

    await syncMentionAutocompleteScroll()
  },
  { flush: 'post' }
)

watch(activeMentionAutocompleteMatchKey, () => {
  mentionAutocompleteUserNavigated.value = false
  mentionAutocompleteHighlightIndex.value = 0
}, { flush: 'sync' })

watch(
  [skillAutocompleteOpen, skillAutocompleteHighlightIndex, filteredSkillAutocompleteResults],
  async ([open, highlightIndex, results]) => {
    if (!open || !results.length || highlightIndex >= results.length) {
      return
    }

    await syncSkillAutocompleteScroll()
  },
  { flush: 'post' }
)

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

watch(input, async (nextValue, previousValue) => {
  if (skipNextSkillMentionSync) {
    skipNextSkillMentionSync = false
  } else {
    insertedSkillMentions.value = reconcileSkillAutocompleteSelections(
      previousValue,
      nextValue,
      insertedSkillMentions.value
    )
  }

  if (skipNextMentionSelectionSync) {
    skipNextMentionSelectionSync = false
  } else {
    insertedMentionSelections.value = reconcileMentionAutocompleteSelections(
      previousValue,
      nextValue,
      insertedMentionSelections.value
    )
  }

  await nextTick()
  syncPromptSelectionFromDom()
}, { flush: 'post' })

watch(
  [mentionAutocompleteOpen, () => selectedProject.value?.projectPath ?? null],
  async ([open, projectPath]) => {
    const requestSequence = ++pluginMentionRequestSequence

    if (!open) {
      pluginMentionLoading.value = false
      pluginMentionError.value = null
      return
    }

    if (!projectPath) {
      pluginMentionLoading.value = false
      pluginMentionCatalog.value = []
      pluginMentionCatalogCwd.value = null
      pluginMentionError.value = null
      return
    }

    if (!shouldReloadPluginMentionCatalog(projectPath)) {
      pluginMentionLoading.value = false
      pluginMentionError.value = null
      return
    }

    pluginMentionLoading.value = true
    pluginMentionError.value = null

    try {
      await loadPluginMentionCatalog({
        projectPath,
        requestSequence
      })
    } catch (caughtError) {
      if (requestSequence !== pluginMentionRequestSequence) {
        return
      }

      pluginMentionError.value = caughtError instanceof Error
        ? caughtError.message
        : 'Failed to load enabled plugins.'
    } finally {
      if (requestSequence === pluginMentionRequestSequence) {
        pluginMentionLoading.value = false
      }
    }
  },
  { flush: 'post' }
)

watch(
  [skillAutocompleteOpen, () => selectedProject.value?.projectPath ?? null, skillAutocompleteInvalidationVersion],
  async ([open, projectPath]) => {
    const requestSequence = ++skillAutocompleteRequestSequence

    if (!open) {
      skillAutocompleteLoading.value = false
      skillAutocompleteError.value = null
      return
    }

    if (!projectPath) {
      skillAutocompleteLoading.value = false
      skillAutocompleteCatalog.value = []
      skillAutocompleteCatalogCwd.value = null
      skillAutocompleteCatalogVersion.value = -1
      skillAutocompleteError.value = null
      return
    }

    if (!shouldReloadSkillAutocompleteCatalog(projectPath)) {
      skillAutocompleteLoading.value = false
      skillAutocompleteError.value = null
      return
    }

    skillAutocompleteLoading.value = true
    skillAutocompleteError.value = null

    try {
      await loadSkillAutocompleteCatalog({
        forceReload: skillAutocompleteCatalogCwd.value === projectPath,
        projectPath,
        requestSequence
      })
    } catch (caughtError) {
      if (requestSequence !== skillAutocompleteRequestSequence) {
        return
      }

      skillAutocompleteError.value = caughtError instanceof Error
        ? caughtError.message
        : 'Failed to load available skills.'
    } finally {
      if (requestSequence === skillAutocompleteRequestSequence) {
        skillAutocompleteLoading.value = false
      }
    }
  },
  { flush: 'post' }
)

watch(
  [mentionAutocompleteOpen, normalizedMentionAutocompleteQuery, () => selectedProject.value?.projectPath ?? null],
  async ([open, query, projectPath]) => {
    const requestSequence = ++fileAutocompleteRequestSequence

    if (!open) {
      fileAutocompleteLoading.value = false
      fileAutocompleteError.value = null
      fileAutocompleteResults.value = []
      return
    }

    if (!projectPath) {
      fileAutocompleteLoading.value = false
      fileAutocompleteError.value = null
      fileAutocompleteResults.value = []
      return
    }

    fileAutocompleteError.value = null
    if (!query) {
      fileAutocompleteLoading.value = false
      fileAutocompleteResults.value = []
      return
    }

    fileAutocompleteLoading.value = true
    fileAutocompleteResults.value = []

    try {
      await ensureProjectRuntime()
      const response = await getRuntimeClient().request('fuzzyFileSearch', {
        query,
        roots: [projectPath],
        cancellationToken: `chat-file-autocomplete:${workspaceSessionKey}`
      })

      if (requestSequence !== fileAutocompleteRequestSequence) {
        return
      }

      fileAutocompleteResults.value = normalizeFuzzyFileSearchMatches(response)
    } catch (caughtError) {
      if (requestSequence !== fileAutocompleteRequestSequence) {
        return
      }

      fileAutocompleteResults.value = []
      fileAutocompleteError.value = caughtError instanceof Error
        ? caughtError.message
        : 'Failed to search project files.'
    } finally {
      if (requestSequence === fileAutocompleteRequestSequence) {
        fileAutocompleteLoading.value = false
      }
    }
  },
  { flush: 'post' }
)
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
        :spacing-offset="chatSpacingOffset"
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
            :project-id="workspaceKind === 'project' ? workspaceId : undefined"
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

    <div
      ref="stickyFooterRef"
      class="sticky bottom-0 shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-2 md:px-6 md:pt-2"
    >
      <div class="pointer-events-none absolute inset-x-0 inset-y-0 bg-gradient-to-b from-transparent via-default/88 to-default" />

      <div class="relative mx-auto w-full max-w-5xl">
        <PlanTaskListPanel
          v-if="currentThreadPlan"
          :plan="currentThreadPlan"
          class="mb-3"
          @toggle="setThreadPlanPanelOpen"
        />

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
            v-if="mentionAutocompleteOpen"
            ref="mentionAutocompleteDropdownRef"
            role="listbox"
            aria-label="Mentions"
            class="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-lg border border-default bg-default/95 shadow-2xl backdrop-blur"
            @pointerdown="handleMentionAutocompletePointerDown"
          >
            <div
              ref="mentionAutocompleteListRef"
              class="max-h-80 overflow-y-auto p-2"
            >
              <div
                v-if="mentionAutocompleteEmptyState"
                class="px-3 py-2 text-sm leading-6 text-muted"
              >
                {{ mentionAutocompleteEmptyState }}
              </div>
              <template v-else>
                <div
                  v-for="section in mentionAutocompleteSections"
                  :key="section.key"
                  class="mt-2 first:mt-0"
                >
                  <div class="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
                    {{ section.title }}
                  </div>
                  <div
                    v-for="item in section.items"
                    :key="item.key"
                    role="option"
                    :aria-selected="resolveMentionAutocompleteIndex(item) === effectiveMentionAutocompleteHighlightIndex"
                    data-mention-autocomplete-option=""
                    class="group relative flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-highlighted outline-none transition-colors before:absolute before:inset-px before:z-[-1] before:rounded-md"
                    :class="resolveMentionAutocompleteIndex(item) === effectiveMentionAutocompleteHighlightIndex
                      ? 'before:bg-elevated'
                      : 'hover:before:bg-elevated/60'"
                    @click="void selectMentionAutocompleteItem(item)"
                  >
                    <template v-if="item.kind === 'agent'">
                      <UAvatar
                        :text="toSubagentAvatarText(item.agent.name)"
                        :alt="item.agent.name"
                        size="xs"
                        :class="resolveSubagentAccent(Math.max(0, item.accentIndex)).avatarClass"
                      />
                      <div class="min-w-0 flex flex-1 items-center gap-2">
                        <span
                          class="shrink-0 text-[13px] font-semibold leading-6"
                          :class="resolveSubagentAccent(Math.max(0, item.accentIndex)).textClass"
                        >
                          {{ item.label }}
                        </span>
                        <span class="min-w-0 truncate text-xs text-muted">
                          {{ resolveAgentMentionDescription(item.agent) }}
                        </span>
                      </div>
                    </template>
                    <template v-else-if="item.kind === 'plugin'">
                      <UAvatar
                        :src="resolvePluginMentionAvatarSrc(item.plugin) || undefined"
                        :icon="resolvePluginMentionAvatarSrc(item.plugin) ? undefined : 'i-lucide-plug'"
                        :text="resolvePluginMentionAvatarText(item.plugin)"
                        :alt="item.label"
                        size="xs"
                      />
                      <div class="min-w-0 flex flex-1 items-center gap-2">
                        <span class="shrink-0 text-[13px] font-medium leading-6">
                          {{ item.label }}
                        </span>
                        <span class="min-w-0 truncate text-xs text-muted">
                          {{ item.description }}
                        </span>
                      </div>
                      <span class="shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
                        {{ item.plugin.marketplaceName }}
                      </span>
                    </template>
                    <template v-else>
                      <UIcon
                        :name="resolveFileAutocompleteIcon(item.file)"
                        class="size-4 shrink-0 text-dimmed group-aria-selected:text-highlighted"
                      />
                      <div class="min-w-0 truncate font-mono text-[13px] leading-6">
                        <span
                          v-for="(segment, segmentIndex) in renderFileAutocompletePathSegments(item.file)"
                          :key="`${item.file.path}:${segmentIndex}:${segment.isMatch ? 'match' : 'plain'}`"
                          class="truncate"
                          :class="segment.isMatch ? 'font-semibold text-primary' : 'text-toned'"
                        >
                          {{ segment.text }}
                        </span>
                      </div>
                    </template>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <div
            v-if="skillAutocompleteOpen"
            ref="skillAutocompleteDropdownRef"
            role="listbox"
            aria-label="Skills"
            class="absolute bottom-full left-0 z-20 mb-2 w-full overflow-hidden rounded-lg border border-default bg-default/95 shadow-2xl backdrop-blur"
            @pointerdown="handleSkillAutocompletePointerDown"
          >
            <div
              ref="skillAutocompleteListRef"
              class="max-h-72 overflow-y-auto p-2"
            >
              <div
                v-if="skillAutocompleteEmptyState"
                class="px-3 py-2 text-sm leading-6 text-muted"
              >
                {{ skillAutocompleteEmptyState }}
              </div>
              <div
                v-for="(skill, index) in filteredSkillAutocompleteResults"
                v-else
                :key="`${skill.scope}:${skill.path}`"
                role="option"
                :aria-selected="index === skillAutocompleteHighlightIndex"
                data-skill-autocomplete-option=""
                class="group relative flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-highlighted outline-none transition-colors before:absolute before:inset-px before:z-[-1] before:rounded-md"
                :class="index === skillAutocompleteHighlightIndex
                  ? 'before:bg-elevated'
                  : 'hover:before:bg-elevated/60'"
                @click="void selectSkillAutocompleteResult(skill)"
              >
                <UIcon
                  :name="resolveSkillAutocompleteIcon(skill)"
                  class="size-4 shrink-0 text-dimmed group-aria-selected:text-highlighted"
                />
                <div class="min-w-0 flex flex-1 items-center gap-2">
                  <span class="shrink-0 font-mono text-[13px] leading-6">
                    {{ resolveSkillAutocompleteLabel(skill) }}
                  </span>
                  <span class="min-w-0 truncate text-xs text-muted">
                    {{ resolveSkillAutocompleteDescription(skill) }}
                  </span>
                </div>
                <div class="shrink-0 text-[11px] uppercase tracking-[0.12em] text-muted">
                  {{ skill.scope }}
                </div>
              </div>
            </div>
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

          <div
            v-if="currentCollaborationModeLabel"
            class="mb-2 flex items-center gap-2 px-1 text-xs text-primary"
          >
            <UIcon
              name="i-lucide-list-checks"
              class="size-3.5"
            />
            <span>{{ currentCollaborationModeLabel }} mode</span>
          </div>

          <UChatPrompt
            ref="chatPromptRef"
            v-model="input"
            :placeholder="composerPlaceholder"
            :error="submitError"
            :disabled="isComposerDisabled"
            :ui="{
              root: 'px-2.5 pt-1 pb-2',
              base: 'px-2.5 pt-1 pb-1.5'
            }"
            autoresize
            @submit.prevent="sendMessage"
            @keydown.enter.exact.capture="onPromptEnterCapture"
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
            <template
              v-if="attachments.length"
              #header
            >
              <div
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

                  <WorkspaceBranchControl
                    v-if="showWorkspaceBranchControl"
                    :current-branch="workspaceCurrentBranch"
                    :branches="workspaceAvailableBranches"
                    :loading="workspaceGitBranchLoading"
                    :submitting="workspaceGitBranchSubmitting"
                    :disabled="isWorkspaceBranchControlDisabled"
                    :error="workspaceGitBranchError"
                    @switch-branch="(branch) => void switchWorkspaceGitBranch(branch)"
                    @create-branch="(branch) => void createWorkspaceGitBranch(branch)"
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

  <PlanImplementationPromptDrawer
    :open="isPlanImplementationPromptOpen"
    @implement="implementCurrentPlan"
    @revise-plan="requestPlanRevision"
    @update:open="(open) => {
      if (!open) {
        closePlanImplementationPrompt()
      }
    }"
  />

  <LocalFileViewerModal />

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
    v-if="workspaceKind === 'project'"
    :project-id="workspaceId"
    :open="usageStatusModalOpen"
    @update:open="handleUsageStatusOpenChange"
  />
</template>

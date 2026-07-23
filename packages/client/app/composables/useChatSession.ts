import { ref, type Ref } from 'vue'
import type { ChatMessage, SubagentAgentStatus, VisualSubagentPanel } from '~~/shared/codex-chat'
import type { CollaborationModeMask } from '~~/shared/collaboration-mode'
import type { ReasoningEffort } from '~~/shared/generated/codex-app-server/ReasoningEffort'
import type { CodexRpcNotification } from '~~/shared/codex-rpc'
import type { ThreadGoal } from '~~/shared/generated/codex-app-server/v2/ThreadGoal'
import type { ThreadPlanState } from '~~/shared/turn-plan'
import type { ModelOption, TokenUsageSnapshot } from '~~/shared/chat-prompt-controls'

export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

export type LiveStreamTurnIdWaiter = {
  resolve: (turnId: string) => void
  reject: (error: Error) => void
}

export type LiveStream = {
  threadId: string
  turnId: string | null
  lockedTurnId: string | null
  bufferedNotifications: CodexRpcNotification[]
  observedSubagentThreadIds: Set<string>
  pendingUserMessageIds: string[]
  turnIdWaiters: LiveStreamTurnIdWaiter[]
  interruptRequested: boolean
  interruptAcknowledged: boolean
  unsubscribe: (() => void) | null
}

export type SubagentPanelState = VisualSubagentPanel & {
  turnId: string | null
  bootstrapped: boolean
  bufferedNotifications: CodexRpcNotification[]
  status: SubagentAgentStatus
}

export type ChatSession = {
  messages: Ref<ChatMessage[]>
  subagentPanels: Ref<SubagentPanelState[]>
  threadGoals: Ref<Record<string, ThreadGoal>>
  threadPlans: Ref<Record<string, ThreadPlanState>>
  threadCollaborationModeMasks: Ref<Record<string, CollaborationModeMask>>
  collaborationModeMasks: Ref<CollaborationModeMask[]>
  collaborationModesLoaded: Ref<boolean>
  collaborationModesLoading: Ref<boolean>
  collaborationModesError: Ref<string | null>
  status: Ref<ChatStatus>
  error: Ref<string | null>
  activeThreadId: Ref<string | null>
  threadTitle: Ref<string | null>
  pendingThreadId: Ref<string | null>
  autoRedirectThreadId: Ref<string | null>
  pendingRealtimeVoiceConnectThreadId: Ref<string | null>
  pendingRealtimeVoiceMicrophoneActivation: Ref<boolean>
  loadVersion: Ref<number>
  promptControlsLoaded: Ref<boolean>
  promptControlsLoading: Ref<boolean>
  promptControlsError: Ref<string | null>
  availableModels: Ref<ModelOption[]>
  selectedModel: Ref<string>
  selectedEffort: Ref<ReasoningEffort>
  selectedServiceTier: Ref<string | null>
  modelContextWindow: Ref<number | null>
  tokenUsage: Ref<TokenUsageSnapshot | null>
  latestPlanTurnId: Ref<string | null>
  queuedPlanImplementationPromptTurnId: Ref<string | null>
  queuedPlanImplementationPromptThreadId: Ref<string | null>
  planImplementationPromptTurnId: Ref<string | null>
  planImplementationPromptThreadId: Ref<string | null>
  shownPlanImplementationPromptTurnIds: Set<string>
  pendingLiveStream: Promise<LiveStream> | null
  liveStream: LiveStream | null
}

const sessions = new Map<string, ChatSession>()

const createSession = (): ChatSession => {
  const session: ChatSession = {
    messages: ref([]) as Ref<ChatMessage[]>,
    subagentPanels: ref([]) as Ref<SubagentPanelState[]>,
    threadGoals: ref({}) as Ref<Record<string, ThreadGoal>>,
    threadPlans: ref({}) as Ref<Record<string, ThreadPlanState>>,
    threadCollaborationModeMasks: ref({}) as Ref<Record<string, CollaborationModeMask>>,
    collaborationModeMasks: ref([]) as Ref<CollaborationModeMask[]>,
    collaborationModesLoaded: ref(false),
    collaborationModesLoading: ref(false),
    collaborationModesError: ref(null) as Ref<string | null>,
    status: ref('ready') as Ref<ChatStatus>,
    error: ref(null) as Ref<string | null>,
    activeThreadId: ref(null) as Ref<string | null>,
    threadTitle: ref(null) as Ref<string | null>,
    pendingThreadId: ref(null) as Ref<string | null>,
    autoRedirectThreadId: ref(null) as Ref<string | null>,
    pendingRealtimeVoiceConnectThreadId: ref(null) as Ref<string | null>,
    pendingRealtimeVoiceMicrophoneActivation: ref(false),
    loadVersion: ref(0),
    promptControlsLoaded: ref(false),
    promptControlsLoading: ref(false),
    promptControlsError: ref(null) as Ref<string | null>,
    availableModels: ref([]) as Ref<ModelOption[]>,
    selectedModel: ref(''),
    selectedEffort: ref('medium') as Ref<ReasoningEffort>,
    selectedServiceTier: ref(null) as Ref<string | null>,
    modelContextWindow: ref(null) as Ref<number | null>,
    tokenUsage: ref(null) as Ref<TokenUsageSnapshot | null>,
    latestPlanTurnId: ref(null) as Ref<string | null>,
    queuedPlanImplementationPromptTurnId: ref(null) as Ref<string | null>,
    queuedPlanImplementationPromptThreadId: ref(null) as Ref<string | null>,
    planImplementationPromptTurnId: ref(null) as Ref<string | null>,
    planImplementationPromptThreadId: ref(null) as Ref<string | null>,
    shownPlanImplementationPromptTurnIds: new Set<string>(),
    pendingLiveStream: null,
    liveStream: null
  }

  return session
}

export const useChatSession = (projectId: string) => {
  const existing = sessions.get(projectId)
  if (existing) {
    return existing
  }

  const session = createSession()
  sessions.set(projectId, session)
  return session
}

export const promoteChatSession = (sourceProjectId: string, targetProjectId: string) => {
  if (sourceProjectId === targetProjectId || sessions.has(targetProjectId)) {
    return
  }

  const session = sessions.get(sourceProjectId)
  if (!session) {
    return
  }

  sessions.set(targetProjectId, session)
  sessions.delete(sourceProjectId)
}

import { ref, type Ref } from 'vue'
import type { ChatMessage, SubagentAgentStatus, VisualSubagentPanel } from '~~/shared/codex-chat'
import type { CodexRpcNotification } from '~~/shared/codex-rpc'
import {
  FALLBACK_MODELS,
  type ModelOption,
  type ReasoningEffort,
  type TokenUsageSnapshot
} from '~~/shared/chat-prompt-controls'

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
  status: Ref<ChatStatus>
  error: Ref<string | null>
  activeThreadId: Ref<string | null>
  threadTitle: Ref<string | null>
  pendingThreadId: Ref<string | null>
  autoRedirectThreadId: Ref<string | null>
  loadVersion: Ref<number>
  promptControlsLoaded: Ref<boolean>
  promptControlsLoading: Ref<boolean>
  availableModels: Ref<ModelOption[]>
  selectedModel: Ref<string>
  selectedEffort: Ref<ReasoningEffort>
  modelContextWindow: Ref<number | null>
  tokenUsage: Ref<TokenUsageSnapshot | null>
  pendingLiveStream: Promise<LiveStream> | null
  liveStream: LiveStream | null
}

const sessions = new Map<string, ChatSession>()

const createSession = (): ChatSession => ({
  messages: ref<ChatMessage[]>([]),
  subagentPanels: ref<SubagentPanelState[]>([]),
  status: ref<ChatStatus>('ready'),
  error: ref<string | null>(null),
  activeThreadId: ref<string | null>(null),
  threadTitle: ref<string | null>(null),
  pendingThreadId: ref<string | null>(null),
  autoRedirectThreadId: ref<string | null>(null),
  loadVersion: ref(0),
  promptControlsLoaded: ref(false),
  promptControlsLoading: ref(false),
  availableModels: ref<ModelOption[]>(FALLBACK_MODELS),
  selectedModel: ref(FALLBACK_MODELS[0]!.model),
  selectedEffort: ref(FALLBACK_MODELS[0]!.defaultReasoningEffort),
  modelContextWindow: ref<number | null>(null),
  tokenUsage: ref<TokenUsageSnapshot | null>(null),
  pendingLiveStream: null,
  liveStream: null
})

export const useChatSession = (projectId: string) => {
  const existing = sessions.get(projectId)
  if (existing) {
    return existing
  }

  const session = createSession()
  sessions.set(projectId, session)
  return session
}

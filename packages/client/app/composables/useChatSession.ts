import { ref, type Ref } from 'vue'
import type { ChatMessage } from '~~/shared/codex-chat.js'
import type { CodexRpcNotification } from '~~/shared/codex-rpc.js'

export type ChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

export type LiveStream = {
  threadId: string
  turnId: string | null
  bufferedNotifications: CodexRpcNotification[]
  unsubscribe: (() => void) | null
}

export type ChatSession = {
  messages: Ref<ChatMessage[]>
  status: Ref<ChatStatus>
  error: Ref<string | null>
  activeThreadId: Ref<string | null>
  threadTitle: Ref<string | null>
  pendingThreadId: Ref<string | null>
  autoRedirectThreadId: Ref<string | null>
  loadVersion: Ref<number>
  liveStream: LiveStream | null
}

const sessions = new Map<string, ChatSession>()

const createSession = (): ChatSession => ({
  messages: ref<ChatMessage[]>([]),
  status: ref<ChatStatus>('ready'),
  error: ref<string | null>(null),
  activeThreadId: ref<string | null>(null),
  threadTitle: ref<string | null>(null),
  pendingThreadId: ref<string | null>(null),
  autoRedirectThreadId: ref<string | null>(null),
  loadVersion: ref(0),
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

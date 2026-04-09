import { ref, type Ref } from 'vue'
import type { CodoriChatMessage } from '~~/shared/codex-chat.js'
import type { CodexRpcNotification } from '~~/shared/codex-rpc.js'

export type CodoriChatStatus = 'ready' | 'submitted' | 'streaming' | 'error'

export type CodoriLiveStream = {
  threadId: string
  turnId: string | null
  bufferedNotifications: CodexRpcNotification[]
  unsubscribe: (() => void) | null
}

export type CodoriChatSession = {
  messages: Ref<CodoriChatMessage[]>
  status: Ref<CodoriChatStatus>
  error: Ref<string | null>
  activeThreadId: Ref<string | null>
  pendingThreadId: Ref<string | null>
  autoRedirectThreadId: Ref<string | null>
  loadVersion: Ref<number>
  liveStream: CodoriLiveStream | null
}

const sessions = new Map<string, CodoriChatSession>()

const createSession = (): CodoriChatSession => ({
  messages: ref<CodoriChatMessage[]>([]),
  status: ref<CodoriChatStatus>('ready'),
  error: ref<string | null>(null),
  activeThreadId: ref<string | null>(null),
  pendingThreadId: ref<string | null>(null),
  autoRedirectThreadId: ref<string | null>(null),
  loadVersion: ref(0),
  liveStream: null
})

export const useCodoriChatSession = (projectId: string) => {
  const existing = sessions.get(projectId)
  if (existing) {
    return existing
  }

  const session = createSession()
  sessions.set(projectId, session)
  return session
}

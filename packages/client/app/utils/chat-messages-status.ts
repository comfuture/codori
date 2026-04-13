import type { ChatStatus } from '../composables/useChatSession'

export const resolveChatMessagesStatus = (
  status: ChatStatus,
  awaitingAssistantOutput: boolean
): ChatStatus => {
  if (status === 'ready' || status === 'error') {
    return status
  }

  return awaitingAssistantOutput ? 'submitted' : 'streaming'
}

import type { ChatStatus } from '../composables/useChatSession'
import {
  ITEM_PART,
  TOOL_GROUP_PART,
  type ChatMessage
} from '../../shared/codex-chat'

export const shouldAwaitAssistantOutput = (
  submissionMethod: 'turn/start' | 'turn/steer'
) => submissionMethod === 'turn/start'

const hasVisibleAssistantPart = (part: ChatMessage['parts'][number]) => {
  switch (part.type) {
    case 'text':
    case 'plan':
      return part.text.trim().length > 0
    case 'reasoning':
      return [...part.summary, ...part.content].some(text => text.trim().length > 0)
    case 'attachment':
    case ITEM_PART:
    case TOOL_GROUP_PART:
      return true
    default:
      return false
  }
}

export const hasVisibleAssistantOutputAfterLatestUserMessage = (
  messages: ChatMessage[]
) => {
  const latestUserMessageIndex = messages.findLastIndex(message => message.role === 'user')
  const candidateMessages = latestUserMessageIndex === -1
    ? messages
    : messages.slice(latestUserMessageIndex + 1)

  return candidateMessages.some(message =>
    message.role === 'assistant'
    && message.parts.some(hasVisibleAssistantPart)
  )
}

export const resolveChatMessagesStatus = (
  status: ChatStatus,
  awaitingAssistantOutput: boolean
): ChatStatus => {
  if (status === 'ready' || status === 'error') {
    return status
  }

  return awaitingAssistantOutput ? 'submitted' : 'streaming'
}

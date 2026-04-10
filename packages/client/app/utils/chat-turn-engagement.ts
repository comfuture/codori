import { upsertStreamingMessage, type ChatMessage } from '../../shared/codex-chat'

const interruptIgnoredMethods = new Set([
  'item/started',
  'item/agentMessage/delta',
  'item/plan/delta',
  'item/reasoning/textDelta',
  'item/reasoning/summaryTextDelta',
  'item/commandExecution/outputDelta',
  'item/fileChange/outputDelta',
  'item/mcpToolCall/progress'
])

export const resolveTurnSubmissionMethod = (hasActiveTurn: boolean) =>
  hasActiveTurn ? 'turn/steer' : 'turn/start'

export const shouldIgnoreNotificationAfterInterrupt = (method: string) =>
  interruptIgnoredMethods.has(method)

export const removeChatMessage = (messages: ChatMessage[], messageId: string) =>
  messages.filter(message => message.id !== messageId)

export const removePendingUserMessageId = (messageIds: string[], messageId: string) =>
  messageIds.filter(candidateId => candidateId !== messageId)

export const reconcileOptimisticUserMessage = (
  messages: ChatMessage[],
  optimisticMessageId: string,
  confirmedMessage: ChatMessage
) => {
  const index = messages.findIndex(message => message.id === optimisticMessageId)
  if (index === -1) {
    return upsertStreamingMessage(messages, confirmedMessage)
  }

  return messages.map((message, messageIndex) =>
    messageIndex === index ? confirmedMessage : message
  )
}

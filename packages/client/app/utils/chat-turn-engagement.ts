import { upsertStreamingMessage, type ChatMessage } from '../../shared/codex-chat'

export type PromptSubmitStatus = 'ready' | 'submitted' | 'streaming' | 'error'

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

export const hasSteerableTurn = (input: {
  activeThreadId: string | null
  liveStreamThreadId: string | null
  liveStreamTurnId: string | null
}) =>
  input.activeThreadId !== null
  && input.liveStreamThreadId === input.activeThreadId
  && input.liveStreamTurnId !== null

export const shouldAwaitThreadHydration = (input: {
  hasPendingThreadHydration: boolean
  routeThreadId: string | null
  activeThreadId: string | null
}) =>
  input.hasPendingThreadHydration
  && input.routeThreadId !== null
  && input.activeThreadId === input.routeThreadId

export const resolvePromptSubmitStatus = (input: {
  status: PromptSubmitStatus
  hasDraftContent: boolean
}) => input.hasDraftContent ? 'ready' : input.status

export const shouldIgnoreNotificationAfterInterrupt = (method: string) =>
  interruptIgnoredMethods.has(method)

export const removeChatMessage = (messages: ChatMessage[], messageId: string) =>
  messages.filter(message => message.id !== messageId)

export const removePendingUserMessageId = (messageIds: string[], messageId: string) =>
  messageIds.filter(candidateId => candidateId !== messageId)

const isEquivalentUserMessagePart = (
  currentPart: ChatMessage['parts'][number],
  confirmedPart: ChatMessage['parts'][number]
) => {
  if (currentPart.type === 'text' && confirmedPart.type === 'text') {
    return currentPart.text === confirmedPart.text
  }

  if (currentPart.type === 'attachment' && confirmedPart.type === 'attachment') {
    return currentPart.attachment.kind === confirmedPart.attachment.kind
      && currentPart.attachment.name === confirmedPart.attachment.name
  }

  return false
}

const findOptimisticUserMessageIndex = (
  messages: ChatMessage[],
  optimisticMessageId: string,
  confirmedMessage: ChatMessage
) => {
  const directIndex = messages.findIndex(message => message.id === optimisticMessageId)
  if (directIndex !== -1) {
    return directIndex
  }

  if (confirmedMessage.role !== 'user') {
    return -1
  }

  return messages.findIndex(message =>
    message.role === 'user'
    && message.pending === true
    && message.parts.length === confirmedMessage.parts.length
    && message.parts.every((part, index) => isEquivalentUserMessagePart(part, confirmedMessage.parts[index]!))
  )
}

export const reconcileOptimisticUserMessage = (
  messages: ChatMessage[],
  optimisticMessageId: string,
  confirmedMessage: ChatMessage
) => {
  const index = findOptimisticUserMessageIndex(messages, optimisticMessageId, confirmedMessage)
  if (index === -1) {
    return upsertStreamingMessage(messages, confirmedMessage)
  }

  return messages.map((message, messageIndex) =>
    messageIndex === index ? confirmedMessage : message
  )
}

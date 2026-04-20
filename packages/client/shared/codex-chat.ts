import type { CodexThread, CodexThreadItem, CodexTurn, CodexUserInput } from './codex-rpc'

export const EVENT_PART = 'data-thread-event' as const
export const ITEM_PART = 'data-thread-item' as const

export type ThreadEventData =
  | {
      kind: 'thread.started' | 'thread.ended' | 'thread.title' | 'turn.started' | 'turn.completed'
      title?: string | null
    }
  | {
      kind: 'review.started'
      summary: string | null
    }
  | {
      kind: 'review.completed'
    }
  | {
      kind: 'turn.failed'
      error: {
        message: string
      } | null
    }
  | {
      kind: 'stream.error'
      message: string
    }

export type CommandExecutionItem = Extract<CodexThreadItem, { type: 'commandExecution' }>

export type FileChangeItem = Extract<CodexThreadItem, { type: 'fileChange' }> & {
  liveOutput?: string | null
}

export type McpToolCallItem = Extract<CodexThreadItem, { type: 'mcpToolCall' }> & {
  progressMessages?: string[]
}

export type DynamicToolCallItem = Extract<CodexThreadItem, { type: 'dynamicToolCall' }> & {
  progressMessages?: string[]
}

export type SubagentTool = Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>['tool']
export type SubagentToolStatus = 'inProgress' | 'completed' | 'failed'
export type SubagentAgentStatus =
  | 'pendingInit'
  | 'running'
  | 'interrupted'
  | 'completed'
  | 'errored'
  | 'shutdown'
  | 'notFound'
  | null

export type SubagentAgentState = {
  threadId: string
  status: SubagentAgentStatus
  message: string | null
}

export type SubagentActivityItem = Omit<Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>, 'agentsStates'> & {
  agentsStates: SubagentAgentState[]
}

export type VisualSubagentPanel = {
  threadId: string
  name: string
  role?: string | null
  status: SubagentAgentStatus
  messages: ChatMessage[]
  firstSeenAt: number
  lastSeenAt: number
}

export type ItemData =
  | {
      kind: 'command_execution'
      item: CommandExecutionItem
    }
  | {
      kind: 'file_change'
      item: FileChangeItem
    }
  | {
      kind: 'mcp_tool_call'
      item: McpToolCallItem
    }
  | {
      kind: 'dynamic_tool_call'
      item: DynamicToolCallItem
    }
  | {
      kind: 'subagent_activity'
      item: SubagentActivityItem
    }
  | {
      kind: 'web_search'
      item: Extract<CodexThreadItem, { type: 'webSearch' }>
    }
  | {
      kind: 'context_compaction'
      item: Extract<CodexThreadItem, { type: 'contextCompaction' }>
    }

export type ChatPart =
  | {
      type: 'text'
      text: string
      state?: 'done' | 'streaming'
    }
  | {
      type: 'plan'
      text: string
      state?: 'done' | 'streaming'
    }
  | {
      type: 'attachment'
      attachment: {
        kind: 'image'
        name: string
        mediaType: string
        url?: string | null
        localPath?: string | null
      }
    }
  | {
      type: 'reasoning'
      summary: string[]
      content: string[]
      state?: 'done' | 'streaming'
    }
  | {
      type: typeof EVENT_PART
      data: ThreadEventData
    }
  | {
      type: typeof ITEM_PART
      data: ItemData
    }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  pending?: boolean
  parts: ChatPart[]
}

export const isSubagentActiveStatus = (status: SubagentAgentStatus) =>
  status === null || status === 'pendingInit' || status === 'running'

const streamingState = (pending?: boolean) => pending ? 'streaming' : 'done'

const attachmentNameFromPath = (path: string) =>
  path.split(/[\\/]/).pop() || 'image'

const attachmentMediaTypeFromUrl = (url: string) => {
  const match = /^data:([^;,]+)[;,]/i.exec(url)
  return match?.[1] || 'image/*'
}

const userInputToParts = (input: CodexUserInput): ChatPart[] => {
  if (input.type === 'text') {
    if (!input.text.trim()) {
      return []
    }

    return [{
      type: 'text',
      text: input.text,
      state: 'done'
    }]
  }

  if (input.type === 'skill' || input.type === 'mention') {
    return []
  }

  if (input.type === 'image') {
    return [{
      type: 'attachment',
      attachment: {
        kind: 'image',
        name: 'image',
        mediaType: attachmentMediaTypeFromUrl(input.url),
        url: input.url
      }
    }]
  }

  return [{
    type: 'attachment',
    attachment: {
      kind: 'image',
      name: attachmentNameFromPath(input.path),
      mediaType: 'image/*',
      localPath: input.path
    }
  }]
}

const getUserMessageText = (item: Extract<CodexThreadItem, { type: 'userMessage' }>) =>
  item.content
    .filter((input): input is Extract<CodexUserInput, { type: 'text' }> => input.type === 'text')
    .map(input => input.text.trim())
    .filter(Boolean)
    .join('\n')

const shouldHideReviewBootstrapUserMessage = (
  item: Extract<CodexThreadItem, { type: 'userMessage' }>,
  turn: CodexTurn
) => {
  const reviewLifecycle = turn.items.find((candidate): candidate is Extract<CodexThreadItem, { type: 'enteredReviewMode' | 'exitedReviewMode' }> =>
    (candidate.type === 'enteredReviewMode' || candidate.type === 'exitedReviewMode')
    && candidate.id === item.id
  )

  if (!reviewLifecycle) {
    return false
  }

  return getUserMessageText(item) === reviewLifecycle.review.trim()
}

export const itemToMessages = (item: CodexThreadItem): ChatMessage[] => {
  switch (item.type) {
    case 'userMessage':
      return [{
        id: item.id,
        role: 'user',
        parts: item.content.flatMap(userInputToParts)
      }]
    case 'agentMessage':
      return [{
        id: item.id,
        role: 'assistant',
        parts: [{
          type: 'text',
          text: item.text,
          state: 'done'
        }]
      }]
    case 'plan':
      return [{
        id: item.id,
        role: 'assistant',
        parts: [{
          type: 'plan',
          text: item.text,
          state: 'done'
        }]
      }]
    case 'reasoning':
      return [{
        id: item.id,
        role: 'assistant',
        parts: [{
          type: 'reasoning',
          summary: item.summary,
          content: item.content,
          state: 'done'
        }]
      }]
    case 'commandExecution':
      return [{
        id: item.id,
        role: 'system',
        pending: item.status === 'inProgress',
        parts: [{
          type: ITEM_PART,
          data: {
            kind: 'command_execution',
            item
          }
        }]
      }]
    case 'fileChange':
      return [{
        id: item.id,
        role: 'system',
        pending: item.status === 'inProgress',
        parts: [{
          type: ITEM_PART,
          data: {
            kind: 'file_change',
            item
          }
        }]
      }]
    case 'mcpToolCall':
      return [{
        id: item.id,
        role: 'system',
        pending: item.status === 'inProgress',
        parts: [{
          type: ITEM_PART,
          data: {
            kind: 'mcp_tool_call',
            item
          }
        }]
      }]
    case 'dynamicToolCall':
      return [{
        id: item.id,
        role: 'system',
        pending: item.status === 'inProgress',
        parts: [{
          type: ITEM_PART,
          data: {
            kind: 'dynamic_tool_call',
            item
          }
        }]
      }]
    case 'collabAgentToolCall':
      return [{
        id: item.id,
        role: 'system',
        pending: item.status === 'inProgress',
        parts: [{
          type: ITEM_PART,
          data: {
            kind: 'subagent_activity',
            item: {
              ...item,
              agentsStates: [
                ...item.receiverThreadIds,
                ...Object.keys(item.agentsStates).filter(threadId => !item.receiverThreadIds.includes(threadId))
              ].map((threadId) => ({
                threadId,
                status: item.agentsStates[threadId]?.status ?? null,
                message: item.agentsStates[threadId]?.message ?? null
              }))
            }
          }
        }]
      }]
    case 'webSearch':
      return [{
        id: item.id,
        role: 'system',
        pending: item.status === 'inProgress',
        parts: [{
          type: ITEM_PART,
          data: {
            kind: 'web_search',
            item
          }
        }]
      }]
    case 'contextCompaction':
      return [{
        id: item.id,
        role: 'system',
        parts: [{
          type: ITEM_PART,
          data: {
            kind: 'context_compaction',
            item
          }
        }]
      }]
    case 'enteredReviewMode':
      return [{
        id: `${item.id}-review-started`,
        role: 'system',
        parts: [{
          type: EVENT_PART,
          data: {
            kind: 'review.started',
            summary: item.review.trim() || null
          }
        }]
      }]
    case 'exitedReviewMode': {
      return [{
        id: `${item.id}-review-completed`,
        role: 'system',
        parts: [{
          type: EVENT_PART,
          data: {
            kind: 'review.completed'
          }
        }]
      }, {
        id: `${item.id}-review-output`,
        role: 'assistant',
        parts: [{
          type: 'text',
          text: item.review,
          state: 'done'
        }]
      }]
    }
    default:
      return []
  }
}

export const threadToMessages = (thread: CodexThread) =>
  thread.turns.flatMap((turn) =>
    turn.items.flatMap((item) => {
      if (item.type === 'userMessage' && shouldHideReviewBootstrapUserMessage(item, turn)) {
        return []
      }

      return itemToMessages(item)
    })
  )

export const eventToMessage = (id: string, data: ThreadEventData): ChatMessage => ({
  id,
  role: 'system',
  parts: [{
    type: EVENT_PART,
    data
  }]
})

const normalizeParts = (message: ChatMessage): ChatPart[] =>
  message.parts.map((part) => {
    if (part.type === 'text') {
      return {
        ...part,
        state: part.state ?? streamingState(message.pending)
      }
    }

    if (part.type === 'reasoning') {
      return {
        ...part,
        state: part.state ?? streamingState(message.pending)
      }
    }

    return part
  })

const normalizeMessage = (message: ChatMessage): ChatMessage => ({
  ...message,
  parts: normalizeParts(message)
})

export const upsertStreamingMessage = (messages: ChatMessage[], nextMessage: ChatMessage) => {
  const normalizedMessage = normalizeMessage(nextMessage)
  const nextMessages = messages.slice()
  const existingIndex = nextMessages.findIndex(message => message.id === normalizedMessage.id)

  if (existingIndex === -1) {
    nextMessages.push(normalizedMessage)
    return nextMessages
  }

  nextMessages.splice(existingIndex, 1, {
    ...nextMessages[existingIndex],
    ...normalizedMessage,
    parts: normalizeParts({
      ...nextMessages[existingIndex],
      ...normalizedMessage
    })
  })

  return nextMessages
}

export const replaceStreamingMessage = (messages: ChatMessage[], nextMessage: ChatMessage) => {
  const normalizedMessage = normalizeMessage(nextMessage)
  const nextMessages = messages.slice()
  const existingIndex = nextMessages.findIndex(message => message.id === normalizedMessage.id)

  if (existingIndex === -1) {
    nextMessages.push(normalizedMessage)
    return nextMessages
  }

  nextMessages.splice(existingIndex, 1, normalizedMessage)
  return nextMessages
}

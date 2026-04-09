import type { CodexThread, CodexThreadItem, CodexUserInput } from './codex-rpc.js'

export const CODORI_EVENT_PART = 'data-codori-event' as const
export const CODORI_ITEM_PART = 'data-codori-item' as const

export type CodoriThreadEventData =
  | {
      kind: 'thread.started' | 'thread.ended' | 'thread.title' | 'turn.started' | 'turn.completed'
      title?: string | null
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

export type CodoriCommandExecutionItem = Extract<CodexThreadItem, { type: 'commandExecution' }>

export type CodoriFileChangeItem = Extract<CodexThreadItem, { type: 'fileChange' }> & {
  liveOutput?: string | null
}

export type CodoriMcpToolCallItem = Extract<CodexThreadItem, { type: 'mcpToolCall' }> & {
  progressMessages?: string[]
}

export type CodoriDynamicToolCallItem = Extract<CodexThreadItem, { type: 'dynamicToolCall' }> & {
  progressMessages?: string[]
}

export type CodoriItemData =
  | {
      kind: 'command_execution'
      item: CodoriCommandExecutionItem
    }
  | {
      kind: 'file_change'
      item: CodoriFileChangeItem
    }
  | {
      kind: 'mcp_tool_call'
      item: CodoriMcpToolCallItem
    }
  | {
      kind: 'dynamic_tool_call'
      item: CodoriDynamicToolCallItem
    }
  | {
      kind: 'web_search'
      item: Extract<CodexThreadItem, { type: 'webSearch' }>
    }
  | {
      kind: 'context_compaction'
      item: Extract<CodexThreadItem, { type: 'contextCompaction' }>
    }

export type CodoriChatPart =
  | {
      type: 'text'
      text: string
      state?: 'done' | 'streaming'
    }
  | {
      type: 'reasoning'
      summary: string[]
      content: string[]
      state?: 'done' | 'streaming'
    }
  | {
      type: typeof CODORI_EVENT_PART
      data: CodoriThreadEventData
    }
  | {
      type: typeof CODORI_ITEM_PART
      data: CodoriItemData
    }

export type CodoriChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  pending?: boolean
  parts: CodoriChatPart[]
}

const formatUserInput = (input: CodexUserInput) => {
  if (input.type === 'text') {
    return input.text
  }

  return `[local image] ${input.path}`
}

const streamingState = (pending?: boolean) => pending ? 'streaming' : 'done'

export const itemToMessages = (item: CodexThreadItem): CodoriChatMessage[] => {
  switch (item.type) {
    case 'userMessage':
      return [{
        id: item.id,
        role: 'user',
        parts: [{
          type: 'text',
          text: item.content.map(formatUserInput).join('\n').trim(),
          state: 'done'
        }]
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
          type: 'text',
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
          type: CODORI_ITEM_PART,
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
          type: CODORI_ITEM_PART,
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
          type: CODORI_ITEM_PART,
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
          type: CODORI_ITEM_PART,
          data: {
            kind: 'dynamic_tool_call',
            item
          }
        }]
      }]
    case 'webSearch':
      return [{
        id: item.id,
        role: 'system',
        pending: item.status === 'inProgress',
        parts: [{
          type: CODORI_ITEM_PART,
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
          type: CODORI_ITEM_PART,
          data: {
            kind: 'context_compaction',
            item
          }
        }]
      }]
    default:
      return []
  }
}

export const threadToMessages = (thread: CodexThread) =>
  thread.turns.flatMap(turn => turn.items.flatMap(item => itemToMessages(item)))

export const eventToMessage = (id: string, data: CodoriThreadEventData): CodoriChatMessage => ({
  id,
  role: 'system',
  parts: [{
    type: CODORI_EVENT_PART,
    data
  }]
})

const normalizeParts = (message: CodoriChatMessage): CodoriChatPart[] =>
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

export const upsertStreamingMessage = (messages: CodoriChatMessage[], nextMessage: CodoriChatMessage) => {
  const normalizedMessage = {
    ...nextMessage,
    parts: normalizeParts(nextMessage)
  }
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

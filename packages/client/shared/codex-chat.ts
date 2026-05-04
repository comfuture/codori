import type { MessagePhase } from './generated/codex-app-server/MessagePhase'
import type { MemoryCitation } from './generated/codex-app-server/v2/MemoryCitation'
import type { Thread } from './generated/codex-app-server/v2/Thread'
import type { ThreadItem } from './generated/codex-app-server/v2/ThreadItem'
import type { Turn } from './generated/codex-app-server/v2/Turn'
import type { UserInput } from './generated/codex-app-server/v2/UserInput'

export const EVENT_PART = 'data-thread-event' as const
export const ITEM_PART = 'data-thread-item' as const
export const TOOL_GROUP_PART = 'data-tool-call-group' as const

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

export type CommandExecutionItem = Extract<ThreadItem, { type: 'commandExecution' }>

export type FileChangeItem = Extract<ThreadItem, { type: 'fileChange' }>
export type McpToolCallItem = Extract<ThreadItem, { type: 'mcpToolCall' }>
export type DynamicToolCallItem = Extract<ThreadItem, { type: 'dynamicToolCall' }>

export type SubagentTool = Extract<ThreadItem, { type: 'collabAgentToolCall' }>['tool']
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

export type SubagentActivityItem = Extract<ThreadItem, { type: 'collabAgentToolCall' }>

export type VisualSubagentPanel = {
  threadId: string
  name: string
  role?: string | null
  status: SubagentAgentStatus
  messages: ChatMessage[]
  firstSeenAt: number
  lastSeenAt: number
}

export type WebSearchStatus = 'inProgress' | 'completed' | 'failed'

export type ItemData =
  | {
      kind: 'command_execution'
      item: CommandExecutionItem
    }
  | {
      kind: 'file_change'
      item: FileChangeItem
      liveOutput?: string | null
    }
  | {
      kind: 'mcp_tool_call'
      item: McpToolCallItem
      progressMessages?: string[]
    }
  | {
      kind: 'dynamic_tool_call'
      item: DynamicToolCallItem
      progressMessages?: string[]
    }
  | {
      kind: 'subagent_activity'
      item: SubagentActivityItem
      agentStates: SubagentAgentState[]
    }
  | {
      kind: 'web_search'
      item: Extract<ThreadItem, { type: 'webSearch' }>
      status: WebSearchStatus
    }
  | {
      kind: 'context_compaction'
      item: Extract<ThreadItem, { type: 'contextCompaction' }>
    }

export type GroupableToolKind = Exclude<ItemData['kind'], 'subagent_activity'>

export type ToolCallGroupData = {
  id: string
  messages: ChatMessage[]
  summary: string
  details: string
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
  | {
      type: typeof TOOL_GROUP_PART
      data: ToolCallGroupData
    }

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  pending?: boolean
  parts: ChatPart[]
}

const groupableToolKinds: GroupableToolKind[] = [
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'dynamic_tool_call',
  'web_search',
  'context_compaction'
]

const groupableToolKindLabels: Record<GroupableToolKind, { singular: string, plural: string }> = {
  command_execution: { singular: 'command', plural: 'commands' },
  file_change: { singular: 'edit', plural: 'edits' },
  mcp_tool_call: { singular: 'MCP tool', plural: 'MCP tools' },
  dynamic_tool_call: { singular: 'internal tool', plural: 'internal tools' },
  web_search: { singular: 'web search', plural: 'web searches' },
  context_compaction: { singular: 'compaction', plural: 'compactions' }
}

const pluralize = (count: number, labels: { singular: string, plural: string }) =>
  `${count} ${count === 1 ? labels.singular : labels.plural}`

const getGroupableToolKind = (message: ChatMessage): GroupableToolKind | null => {
  if (message.role !== 'system' || message.parts.length !== 1) {
    return null
  }

  const [part] = message.parts
  if (part?.type !== ITEM_PART) {
    return null
  }

  const kind = part.data.kind
  return groupableToolKinds.includes(kind as GroupableToolKind)
    ? kind as GroupableToolKind
    : null
}

const isSuccessfullyCompletedToolMessage = (message: ChatMessage) => {
  if (message.pending || message.parts.length !== 1) {
    return false
  }

  const [part] = message.parts
  if (part?.type !== ITEM_PART) {
    return false
  }

  switch (part.data.kind) {
    case 'command_execution':
    case 'file_change':
    case 'mcp_tool_call':
    case 'dynamic_tool_call':
      return part.data.item.status === 'completed'
    case 'web_search':
      return part.data.status === 'completed'
    case 'context_compaction':
      return true
    default:
      return false
  }
}

const hasAssistantOutputPart = (message: ChatMessage) =>
  message.role === 'assistant'
  && message.parts.some(part =>
    part.type === 'text'
    || part.type === 'reasoning'
    || part.type === 'plan'
  )

const isDisplayOnlySystemEvent = (message: ChatMessage) =>
  message.role === 'system'
  && message.parts.length === 1
  && message.parts[0]?.type === EVENT_PART

const buildToolGroupData = (messages: ChatMessage[]): ToolCallGroupData => {
  const counts = new Map<GroupableToolKind, number>()
  for (const message of messages) {
    const kind = getGroupableToolKind(message)
    if (!kind) {
      continue
    }

    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }

  const details = groupableToolKinds
    .map((kind) => {
      const count = counts.get(kind) ?? 0
      return count > 0 ? pluralize(count, groupableToolKindLabels[kind]) : null
    })
    .filter((detail): detail is string => Boolean(detail))
    .join(', ')

  return {
    id: `tool-group:${messages.length}:${messages[0]?.id ?? 'start'}:${messages[messages.length - 1]?.id ?? 'end'}`,
    messages,
    summary: pluralize(messages.length, { singular: 'tool call', plural: 'tool calls' }),
    details
  }
}

const groupToolRun = (toolRun: ChatMessage[]): ChatMessage[] => {
  if (toolRun.length <= 1 || toolRun.some(message => !isSuccessfullyCompletedToolMessage(message))) {
    return toolRun
  }

  const data = buildToolGroupData(toolRun)
  return [{
    id: data.id,
    role: 'system',
    parts: [{
      type: TOOL_GROUP_PART,
      data
    }]
  }]
}

export const groupTranscriptMessages = (messages: ChatMessage[]): ChatMessage[] => {
  const grouped: ChatMessage[] = []
  let pendingToolRun: ChatMessage[] = []
  let pendingSystemEvents: ChatMessage[] = []

  for (const message of messages) {
    const toolKind = getGroupableToolKind(message)
    if (toolKind && isSuccessfullyCompletedToolMessage(message)) {
      if (pendingSystemEvents.length > 0) {
        grouped.push(...pendingToolRun, ...pendingSystemEvents)
        pendingToolRun = []
        pendingSystemEvents = []
      }

      pendingToolRun.push(message)
      continue
    }

    if (pendingToolRun.length > 0) {
      if (isDisplayOnlySystemEvent(message)) {
        pendingSystemEvents.push(message)
        continue
      }

      grouped.push(...(hasAssistantOutputPart(message) ? groupToolRun(pendingToolRun) : pendingToolRun))
      grouped.push(...pendingSystemEvents)
      pendingToolRun = []
      pendingSystemEvents = []
    }

    grouped.push(message)
  }

  grouped.push(...pendingToolRun, ...pendingSystemEvents)
  return grouped
}

export const asAgentMessageItem = (input: {
  id: string
  text: string
  phase?: MessagePhase | null
  memoryCitation?: MemoryCitation | null
}): Extract<ThreadItem, { type: 'agentMessage' }> => ({
  type: 'agentMessage',
  id: input.id,
  text: input.text,
  phase: input.phase ?? null,
  memoryCitation: input.memoryCitation ?? null
})

export const isSubagentActiveStatus = (status: SubagentAgentStatus) =>
  status === null || status === 'pendingInit' || status === 'running'

const flattenSubagentAgentStates = (
  item: SubagentActivityItem
): SubagentAgentState[] => [
  ...item.receiverThreadIds,
  ...Object.keys(item.agentsStates).filter(threadId => !item.receiverThreadIds.includes(threadId))
].map((threadId) => ({
  threadId,
  status: item.agentsStates[threadId]?.status ?? null,
  message: item.agentsStates[threadId]?.message ?? null
}))

const streamingState = (pending?: boolean) => pending ? 'streaming' : 'done'

const attachmentNameFromPath = (path: string) =>
  path.split(/[\\/]/).pop() || 'image'

const attachmentMediaTypeFromUrl = (url: string) => {
  const match = /^data:([^;,]+)[;,]/i.exec(url)
  return match?.[1] || 'image/*'
}

const userInputToParts = (input: UserInput): ChatPart[] => {
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

const getUserMessageText = (item: Extract<ThreadItem, { type: 'userMessage' }>) =>
  item.content
    .filter((input): input is Extract<UserInput, { type: 'text' }> => input.type === 'text')
    .map(input => input.text.trim())
    .filter(Boolean)
    .join('\n')

const shouldHideReviewBootstrapUserMessage = (
  item: Extract<ThreadItem, { type: 'userMessage' }>,
  turn: Turn
) => {
  const reviewLifecycle = turn.items.find((candidate): candidate is Extract<ThreadItem, { type: 'enteredReviewMode' | 'exitedReviewMode' }> =>
    (candidate.type === 'enteredReviewMode' || candidate.type === 'exitedReviewMode')
    && candidate.id === item.id
  )

  if (!reviewLifecycle) {
    return false
  }

  return getUserMessageText(item) === reviewLifecycle.review.trim()
}

export const itemToMessages = (
  item: ThreadItem,
  options: {
    webSearchPending?: boolean
    webSearchStatus?: WebSearchStatus
  } = {}
): ChatMessage[] => {
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
            item,
            agentStates: flattenSubagentAgentStates(item)
          }
        }]
      }]
    case 'webSearch':
      return [{
        id: item.id,
        role: 'system',
        pending: options.webSearchPending,
        parts: [{
          type: ITEM_PART,
          data: {
            kind: 'web_search',
            item,
            status: options.webSearchStatus ?? 'completed'
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

export const threadToMessages = (thread: Thread) =>
  thread.turns.flatMap((turn) =>
    turn.items.flatMap((item) => {
      if (item.type === 'userMessage' && shouldHideReviewBootstrapUserMessage(item, turn)) {
        return []
      }

      return itemToMessages(item, {
        webSearchPending: item.type === 'webSearch' && turn.status === 'inProgress',
        webSearchStatus: item.type === 'webSearch'
          ? (turn.status === 'failed'
            ? 'failed'
            : turn.status === 'inProgress'
              ? 'inProgress'
              : 'completed')
          : undefined
      })
    })
  )

export const findLatestPlanTurnId = (turns: Turn[]) => {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn && turn.items.some(item => item.type === 'plan')) {
      return turn.id
    }
  }

  return null
}

export const findLatestCompletedPlanTurnId = (turns: Turn[]) => {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]
    if (turn && turn.status === 'completed' && turn.items.some(item => item.type === 'plan')) {
      return turn.id
    }
  }

  return null
}

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

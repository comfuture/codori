import type { MessagePhase } from './generated/codex-app-server/MessagePhase'
import type { MemoryCitation } from './generated/codex-app-server/v2/MemoryCitation'
import type { Thread } from './generated/codex-app-server/v2/Thread'
import type { ThreadItem } from './generated/codex-app-server/v2/ThreadItem'
import type { Turn } from './generated/codex-app-server/v2/Turn'
import type { UserInput } from './generated/codex-app-server/v2/UserInput'

export const EVENT_PART = 'data-thread-event' as const
export const ITEM_PART = 'data-thread-item' as const
export const REALTIME_DELEGATION_PART = 'data-realtime-delegation' as const
export const TOOL_GROUP_PART = 'data-tool-call-group' as const

export type RealtimeDelegationData = {
  input: string
  transcriptDelta: string | null
  source: 'handoff' | 'transcript_tail_flush'
  // `partial` marks a wrapper that is still streaming, unterminated, or whose body
  // yielded no usable input. The component then presents the designed block without
  // inventing content, and raw markup never reaches the transcript as ordinary text.
  parse?: 'complete' | 'partial'
}

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
export type SubagentToolStatus = Extract<ThreadItem, { type: 'collabAgentToolCall' }>['status']
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

export type GroupableToolKind = Exclude<ItemData['kind'], 'subagent_activity' | 'context_compaction'>

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
        kind: 'image' | 'audio'
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
      type: typeof REALTIME_DELEGATION_PART
      data: RealtimeDelegationData
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
  delivery?: Extract<ThreadItem, { type: 'agentMessage' }>['delivery']
  parts: ChatPart[]
}

type ItemToMessagesOptions = {
  webSearchPending?: boolean
  webSearchStatus?: WebSearchStatus
  includeReviewOutput?: boolean
}

const groupableToolKinds: GroupableToolKind[] = [
  'command_execution',
  'file_change',
  'mcp_tool_call',
  'dynamic_tool_call',
  'web_search'
]

const groupableToolKindLabels: Record<GroupableToolKind, { singular: string, plural: string }> = {
  command_execution: { singular: 'command', plural: 'commands' },
  file_change: { singular: 'edit', plural: 'edits' },
  mcp_tool_call: { singular: 'MCP tool', plural: 'MCP tools' },
  dynamic_tool_call: { singular: 'internal tool', plural: 'internal tools' },
  web_search: { singular: 'web search', plural: 'web searches' }
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
  delivery?: Extract<ThreadItem, { type: 'agentMessage' }>['delivery']
}): Extract<ThreadItem, { type: 'agentMessage' }> => ({
  type: 'agentMessage',
  id: input.id,
  text: input.text,
  phase: input.phase ?? null,
  memoryCitation: input.memoryCitation ?? null,
  delivery: input.delivery ?? null
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

const attachmentNameFromPath = (path: string, fallback: 'image' | 'audio') =>
  path.split(/[\\/]/).pop() || fallback

const attachmentMediaTypeFromUrl = (url: string, fallback: string) => {
  const match = /^data:([^;,]+)[;,]/i.exec(url)
  return match?.[1] || fallback
}

const normalizeReviewOutputText = (text: string) =>
  text.replace(/\r\n?/gu, '\n').trim()

const hasSameReviewOutputText = (left: string, right: string) =>
  normalizeReviewOutputText(left) === normalizeReviewOutputText(right)

export const hasAssistantTextMessageWithText = (messages: ChatMessage[], text: string) => {
  const normalizedText = normalizeReviewOutputText(text)
  if (!normalizedText) {
    return false
  }

  return messages.some(message =>
    message.role === 'assistant'
    && message.parts.some(part =>
      part.type === 'text'
      && normalizeReviewOutputText(part.text) === normalizedText
    )
  )
}

const isTurnBoundaryMessage = (message: ChatMessage) =>
  message.role === 'user'
  || (
    message.role === 'system'
    && message.parts.some(part =>
      part.type === REALTIME_DELEGATION_PART
      || (
        part.type === EVENT_PART
        && part.data.kind === 'turn.started'
      )
    )
  )

const findLatestTurnBoundaryIndex = (messages: ChatMessage[]) => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isTurnBoundaryMessage(messages[index]!)) {
      return index
    }
  }

  return -1
}

export const hasAssistantTextMessageWithTextInLatestTurn = (messages: ChatMessage[], text: string) =>
  hasAssistantTextMessageWithText(messages.slice(findLatestTurnBoundaryIndex(messages) + 1), text)

const isSyntheticReviewOutputMessage = (message: ChatMessage, text: string) =>
  message.id.endsWith('-review-output')
  && message.role === 'assistant'
  && message.parts.some(part =>
    part.type === 'text'
    && hasSameReviewOutputText(part.text, text)
  )

export const removeSyntheticReviewOutputMessages = (messages: ChatMessage[], text: string) =>
  messages.filter(message => !isSyntheticReviewOutputMessage(message, text))

export const removeSyntheticReviewOutputMessagesInLatestTurn = (messages: ChatMessage[], text: string) => {
  const latestTurnBoundaryIndex = findLatestTurnBoundaryIndex(messages)
  return messages.filter((message, index) =>
    index <= latestTurnBoundaryIndex
    || !isSyntheticReviewOutputMessage(message, text)
  )
}

const decodeRealtimeXmlText = (text: string) =>
  text
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')

const realtimeElementText = (body: string, element: string) => {
  const match = new RegExp(`<${element}>\\s*([\\s\\S]*?)\\s*</${element}>`, 'u').exec(body)
  return match?.[1] ? decodeRealtimeXmlText(match[1].trim()) : null
}

const REALTIME_DELEGATION_OPEN_TAG = '<realtime_delegation>'
const REALTIME_DELEGATION_CLOSE_TAG = '</realtime_delegation>'

// An element that is still streaming has an opening tag with no closing tag yet.
const danglingRealtimeElementText = (body: string, element: string) => {
  const match = new RegExp(`<${element}>\\s*([\\s\\S]*)$`, 'u').exec(body)
  return match?.[1] ? decodeRealtimeXmlText(match[1].trim()) : null
}

const withoutRealtimeElement = (body: string, element: string) =>
  body
    .replace(new RegExp(`<${element}>\\s*[\\s\\S]*?\\s*</${element}>`, 'u'), '')
    .replace(new RegExp(`<${element}>[\\s\\S]*$`, 'u'), '')

// The legacy shape carries the delegated request as bare body text. Residual markup
// means the body was not understood, so it is not presented as request text.
const realtimeDelegationBodyText = (body: string) => {
  const remainder = decodeRealtimeXmlText(
    ['source', 'transcript_delta', 'input']
      .reduce(withoutRealtimeElement, body)
      .trim()
  )

  return /<[^>]+>/u.test(remainder) ? '' : remainder
}

// The wrapper is produced upstream by the realtime voice path, so its exact shape is
// untrusted input. Detection stays deliberately permissive: any wrapper marker yields
// the designed delegation block, and only text with no marker at all is left alone.
const realtimeDelegationFromBody = (
  body: string,
  terminated: boolean
): RealtimeDelegationData => {
  const transcriptDelta = realtimeElementText(body, 'transcript_delta')
    ?? (terminated ? null : danglingRealtimeElementText(body, 'transcript_delta'))
  const source = realtimeElementText(body, 'source') === 'transcript_tail_flush'
    ? 'transcript_tail_flush'
    : 'handoff'
  const delegationInput = realtimeElementText(body, 'input')
    ?? realtimeDelegationBodyText(body)
    ?? ''
  const partialInput = delegationInput || danglingRealtimeElementText(body, 'input') || ''

  if (terminated && delegationInput) {
    return {
      input: delegationInput,
      transcriptDelta,
      source
    }
  }

  return {
    input: partialInput,
    // A body that yields no usable input still renders the designed block, and the
    // unparsed remainder stays inside the conversation-context disclosure instead of
    // reaching the transcript as raw markup.
    transcriptDelta: transcriptDelta
      ?? (partialInput ? null : decodeRealtimeXmlText(body.trim()) || null),
    source,
    parse: 'partial'
  }
}

export const parseRealtimeDelegation = (text: string): RealtimeDelegationData | null => {
  const segment = realtimeDelegationSegments(text)
    .find(candidate => candidate.kind === 'delegation')

  return segment?.kind === 'delegation' ? segment.data : null
}

type RealtimeDelegationSegment =
  | {
      kind: 'text'
      text: string
    }
  | {
      kind: 'delegation'
      data: RealtimeDelegationData
    }

export const realtimeDelegationSegments = (text: string): RealtimeDelegationSegment[] => {
  // Entity-encoded wrappers arrive from the same upstream path, so decode the whole
  // text when only the encoded marker is present.
  const source = text.includes(REALTIME_DELEGATION_OPEN_TAG)
    ? text
    : (text.includes('&lt;realtime_delegation&gt;') ? decodeRealtimeXmlText(text) : text)

  if (!source.includes(REALTIME_DELEGATION_OPEN_TAG)) {
    return [{
      kind: 'text',
      text
    }]
  }

  const segments: RealtimeDelegationSegment[] = []
  let cursor = 0

  while (cursor < source.length) {
    const openIndex = source.indexOf(REALTIME_DELEGATION_OPEN_TAG, cursor)
    if (openIndex < 0) {
      segments.push({
        kind: 'text',
        text: source.slice(cursor)
      })
      break
    }

    if (openIndex > cursor) {
      segments.push({
        kind: 'text',
        text: source.slice(cursor, openIndex)
      })
    }

    const bodyStart = openIndex + REALTIME_DELEGATION_OPEN_TAG.length
    const closeIndex = source.indexOf(REALTIME_DELEGATION_CLOSE_TAG, bodyStart)
    if (closeIndex < 0) {
      segments.push({
        kind: 'delegation',
        data: realtimeDelegationFromBody(source.slice(bodyStart), false)
      })
      break
    }

    segments.push({
      kind: 'delegation',
      data: realtimeDelegationFromBody(source.slice(bodyStart, closeIndex), true)
    })
    cursor = closeIndex + REALTIME_DELEGATION_CLOSE_TAG.length
  }

  return segments.filter(segment => segment.kind !== 'text' || segment.text.trim())
}

const userInputToParts = (input: UserInput): ChatPart[] => {
  if (input.type === 'text') {
    if (!input.text.trim()) {
      return []
    }

    // Text outside the wrapper survives as its own text part, so surrounding prose is
    // preserved while the wrapped portion always renders as the designed block.
    return realtimeDelegationSegments(input.text).map(segment => segment.kind === 'delegation'
      ? {
          type: REALTIME_DELEGATION_PART,
          data: segment.data
        }
      : {
          type: 'text',
          text: segment.text,
          state: 'done'
        })
  }

  if (input.type === 'skill' || input.type === 'mention') {
    return []
  }

  if (input.type === 'image' || input.type === 'audio') {
    const kind = input.type
    return [{
      type: 'attachment',
      attachment: {
        kind,
        name: kind,
        mediaType: attachmentMediaTypeFromUrl(input.url, `${kind}/*`),
        url: input.url
      }
    }]
  }

  const kind = input.type === 'localAudio' ? 'audio' : 'image'
  return [{
    type: 'attachment',
    attachment: {
      kind,
      name: attachmentNameFromPath(input.path, kind),
      mediaType: `${kind}/*`,
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
  options: ItemToMessagesOptions = {}
): ChatMessage[] => {
  switch (item.type) {
    case 'userMessage': {
      const parts = item.content.flatMap(userInputToParts)
      return [{
        id: item.id,
        role: parts.length > 0 && parts.every(part => part.type === REALTIME_DELEGATION_PART)
          ? 'system'
          : 'user',
        parts
      }]
    }
    case 'agentMessage':
      return [{
        id: item.id,
        role: 'assistant',
        ...(item.delivery ? { delivery: item.delivery } : {}),
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
      const messages: ChatMessage[] = [{
        id: `${item.id}-review-completed`,
        role: 'system',
        parts: [{
          type: EVENT_PART,
          data: {
            kind: 'review.completed'
          }
        }]
      }]

      if (options.includeReviewOutput !== false) {
        messages.push({
          id: `${item.id}-review-output`,
          role: 'assistant',
          parts: [{
            type: 'text',
            text: item.review,
            state: 'done'
          }]
        })
      }

      return messages
    }
    default:
      return []
  }
}

const turnHasAgentMessageWithReviewOutput = (turn: Turn, reviewOutput: string) =>
  turn.items.some(item =>
    item.type === 'agentMessage'
    && hasSameReviewOutputText(item.text, reviewOutput)
  )

export const threadToMessages = (thread: Thread) =>
  thread.turns.flatMap((turn) =>
    turn.items.flatMap((item) => {
      if (item.type === 'userMessage' && shouldHideReviewBootstrapUserMessage(item, turn)) {
        return []
      }

      return itemToMessages(item, {
        includeReviewOutput: item.type === 'exitedReviewMode'
          ? !turnHasAgentMessageWithReviewOutput(turn, item.review)
          : undefined,
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

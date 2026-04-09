import type { CodexThread, CodexThreadItem, CodexUserInput } from './codex-rpc.js'

export type CodoriChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  label?: string
  pending?: boolean
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null

const joinNonEmpty = (parts: Array<string | null | undefined>, separator = '\n') =>
  parts.filter((value): value is string => Boolean(value && value.trim())).join(separator)

const formatUserInput = (input: CodexUserInput) => {
  if (input.type === 'text') {
    return input.text
  }

  return `[local image] ${input.path}`
}

const formatStructuredValue = (value: unknown) => {
  if (typeof value === 'string') {
    return value
  }

  if (value == null) {
    return ''
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const formatFileChanges = (item: Extract<CodexThreadItem, { type: 'fileChange' }>) => {
  if (!item.changes.length) {
    return 'Applying file changes.'
  }

  return item.changes
    .map(change => {
      const record = asRecord(change.kind)
      const kind = typeof record?.type === 'string'
        ? record.type
        : typeof change.kind === 'string'
          ? change.kind
          : 'update'
      return `${kind}: ${change.path}`
    })
    .join('\n')
}

const formatDynamicTool = (item: Extract<CodexThreadItem, { type: 'dynamicToolCall' }>) =>
  joinNonEmpty([
    `Tool: ${item.tool}`,
    item.contentItems?.map(entry =>
      entry.type === 'inputText' ? entry.text : `[image] ${entry.imageUrl}`
    ).join('\n') ?? null
  ])

export const itemToMessages = (item: CodexThreadItem): CodoriChatMessage[] => {
  switch (item.type) {
    case 'userMessage':
      return [{
        id: item.id,
        role: 'user',
        text: item.content.map(formatUserInput).join('\n').trim()
      }]
    case 'agentMessage':
      return [{
        id: item.id,
        role: 'assistant',
        text: item.text
      }]
    case 'plan':
      return [{
        id: item.id,
        role: 'assistant',
        label: 'Plan',
        text: item.text
      }]
    case 'reasoning':
      return [{
        id: item.id,
        role: 'assistant',
        label: 'Reasoning',
        text: joinNonEmpty([
          item.summary.join('\n'),
          item.content.join('\n')
        ])
      }]
    case 'commandExecution':
      return [{
        id: item.id,
        role: 'system',
        label: item.command,
        text: joinNonEmpty([
          item.aggregatedOutput ?? '',
          item.exitCode != null ? `Exit code: ${item.exitCode}` : null
        ]),
        pending: item.status === 'inProgress'
      }]
    case 'fileChange':
      return [{
        id: item.id,
        role: 'system',
        label: 'File changes',
        text: formatFileChanges(item),
        pending: item.status === 'inProgress'
      }]
    case 'mcpToolCall':
      return [{
        id: item.id,
        role: 'system',
        label: `${item.server}/${item.tool}`,
        text: joinNonEmpty([
          item.error?.message ?? null,
          formatStructuredValue(item.result?.structuredContent),
          Array.isArray(item.result?.content) ? item.result.content.map(formatStructuredValue).join('\n') : null
        ]),
        pending: item.status === 'inProgress'
      }]
    case 'dynamicToolCall':
      return [{
        id: item.id,
        role: 'system',
        label: 'Dynamic tool',
        text: formatDynamicTool(item),
        pending: item.status === 'inProgress'
      }]
    case 'webSearch':
      return [{
        id: item.id,
        role: 'system',
        label: 'Web search',
        text: item.query
      }]
    case 'contextCompaction':
      return [{
        id: item.id,
        role: 'system',
        label: 'Context compaction',
        text: 'Thread context was compacted.'
      }]
    default:
      return []
  }
}

export const threadToMessages = (thread: CodexThread) =>
  thread.turns.flatMap(turn => turn.items.flatMap(item => itemToMessages(item)))

export const upsertStreamingMessage = (messages: CodoriChatMessage[], nextMessage: CodoriChatMessage) => {
  const nextMessages = messages.slice()
  const existingIndex = nextMessages.findIndex(message => message.id === nextMessage.id)

  if (existingIndex === -1) {
    nextMessages.push(nextMessage)
    return nextMessages
  }

  nextMessages.splice(existingIndex, 1, {
    ...nextMessages[existingIndex],
    ...nextMessage
  })

  return nextMessages
}

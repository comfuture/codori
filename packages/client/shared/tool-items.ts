import {
  ITEM_PART,
  itemToMessages,
  type ItemData,
  type WebSearchStatus
} from './codex-chat'
import type { CodexRpcNotification } from './codex-rpc'
import type { ThreadItem } from './generated/codex-app-server/v2/ThreadItem'

export const DEFAULT_TOOL_OUTPUT_CHARACTER_LIMIT = 64 * 1024
export const TOOL_OUTPUT_TRUNCATION_MARKER = '… earlier output truncated …\n'

export type PresentableToolItemData = Extract<
  ItemData,
  {
    kind:
      | 'command_execution'
      | 'file_change'
      | 'mcp_tool_call'
      | 'dynamic_tool_call'
      | 'web_search'
  }
>

export type ToolItemPresentationStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'declined'

export type ToolItemPresentation = {
  id: string
  kind: PresentableToolItemData['kind']
  title: string
  status: ToolItemPresentationStatus
  text: string
  processId: string | null
  cwd: string | null
  exitCode: number | null
  truncated: boolean
}

export type ToolItemState = {
  id: string
  data: PresentableToolItemData
}

export type ToolItemStore = Record<string, ToolItemState>

export const createToolItemStore = (): ToolItemStore => ({})

export const createFallbackCommandItemData = (
  itemId: string
): Extract<ItemData, { kind: 'command_execution' }> => ({
  kind: 'command_execution',
  item: {
    type: 'commandExecution',
    id: itemId,
    command: 'Command',
    cwd: '',
    processId: null,
    source: 'agent',
    commandActions: [],
    aggregatedOutput: '',
    exitCode: null,
    status: 'inProgress',
    durationMs: null
  }
})

export const createFallbackFileChangeItemData = (
  itemId: string
): Extract<ItemData, { kind: 'file_change' }> => ({
  kind: 'file_change',
  item: {
    type: 'fileChange',
    id: itemId,
    changes: [],
    status: 'inProgress'
  },
  liveOutput: ''
})

export const createFallbackMcpToolItemData = (
  itemId: string
): Extract<ItemData, { kind: 'mcp_tool_call' }> => ({
  kind: 'mcp_tool_call',
  item: {
    type: 'mcpToolCall',
    id: itemId,
    server: 'mcp',
    tool: 'tool',
    arguments: null,
    appContext: null,
    pluginId: null,
    result: null,
    error: null,
    status: 'inProgress',
    durationMs: null
  },
  progressMessages: []
})

const asPresentableToolItemData = (
  item: ThreadItem,
  status: WebSearchStatus
): PresentableToolItemData | null => {
  const message = itemToMessages(item, {
    webSearchPending: status === 'inProgress',
    webSearchStatus: status
  })[0]
  const part = message?.parts.find(candidate => candidate.type === ITEM_PART)
  if (
    !part
    || part.type !== ITEM_PART
    || part.data.kind === 'subagent_activity'
    || part.data.kind === 'context_compaction'
  ) {
    return null
  }
  return part.data
}

const mergeCompletedToolData = (
  previous: PresentableToolItemData | undefined,
  authoritative: PresentableToolItemData
): PresentableToolItemData => {
  if (previous?.kind === 'command_execution' && authoritative.kind === 'command_execution') {
    return {
      ...authoritative,
      item: {
        ...authoritative.item,
        aggregatedOutput: authoritative.item.aggregatedOutput
          ?? previous.item.aggregatedOutput
      }
    }
  }
  if (previous?.kind === 'file_change' && authoritative.kind === 'file_change') {
    return {
      ...authoritative,
      liveOutput: previous.liveOutput
    }
  }
  if (previous?.kind === 'mcp_tool_call' && authoritative.kind === 'mcp_tool_call') {
    return {
      ...authoritative,
      progressMessages: previous.progressMessages
    }
  }
  if (previous?.kind === 'dynamic_tool_call' && authoritative.kind === 'dynamic_tool_call') {
    return {
      ...authoritative,
      progressMessages: previous.progressMessages
    }
  }
  return authoritative
}

export const reduceToolItemDataNotification = (
  current: PresentableToolItemData | undefined,
  notification: CodexRpcNotification
): PresentableToolItemData | null => {
  if (notification.method === 'item/started' || notification.method === 'item/completed') {
    const params = notification.params as { item: ThreadItem }
    const status = notification.method === 'item/started' ? 'inProgress' : 'completed'
    const authoritative = asPresentableToolItemData(params.item, status)
    return authoritative
      ? mergeCompletedToolData(current, authoritative)
      : null
  }

  const params = notification.params as {
    itemId?: string
    delta?: string
    message?: string
  }
  if (!params.itemId) {
    return null
  }

  if (notification.method === 'item/commandExecution/outputDelta') {
    const base = current?.kind === 'command_execution'
      ? current
      : createFallbackCommandItemData(params.itemId)
    return {
      kind: 'command_execution',
      item: {
        ...base.item,
        aggregatedOutput: `${base.item.aggregatedOutput ?? ''}${params.delta ?? ''}`,
        status: 'inProgress'
      }
    }
  }

  if (notification.method === 'item/fileChange/outputDelta') {
    const base = current?.kind === 'file_change'
      ? current
      : createFallbackFileChangeItemData(params.itemId)
    return {
      kind: 'file_change',
      item: {
        ...base.item,
        status: 'inProgress'
      },
      liveOutput: `${base.liveOutput ?? ''}${params.delta ?? ''}`
    }
  }

  if (notification.method === 'item/mcpToolCall/progress') {
    const base = current?.kind === 'mcp_tool_call'
      ? current
      : createFallbackMcpToolItemData(params.itemId)
    return {
      kind: 'mcp_tool_call',
      item: {
        ...base.item,
        status: 'inProgress'
      },
      progressMessages: [
        ...(base.progressMessages ?? []),
        params.message ?? ''
      ]
    }
  }

  return null
}

const notificationItemId = (notification: CodexRpcNotification) => {
  const params = notification.params as {
    item?: { id?: unknown }
    itemId?: unknown
  } | undefined
  if (typeof params?.item?.id === 'string') {
    return params.item.id
  }
  return typeof params?.itemId === 'string' ? params.itemId : null
}

export const reduceToolItemNotification = (
  store: ToolItemStore,
  notification: CodexRpcNotification,
  options: {
    threadId?: string | null
  } = {}
): ToolItemStore => {
  const params = notification.params as { threadId?: unknown } | undefined
  if (
    options.threadId
    && typeof params?.threadId === 'string'
    && params.threadId !== options.threadId
  ) {
    return store
  }

  if (notification.method === 'turn/completed') {
    const turn = (notification.params as {
      turn?: { status?: string }
    }).turn
    if (turn?.status !== 'failed') {
      return store
    }
    let changed = false
    const nextStore: ToolItemStore = { ...store }
    for (const [id, entry] of Object.entries(store)) {
      if (entry.data.kind === 'web_search' && entry.data.status === 'inProgress') {
        changed = true
        nextStore[id] = {
          ...entry,
          data: {
            ...entry.data,
            status: 'failed'
          }
        }
      }
    }
    return changed ? nextStore : store
  }

  const itemId = notificationItemId(notification)
  if (!itemId) {
    return store
  }
  const nextData = reduceToolItemDataNotification(store[itemId]?.data, notification)
  if (!nextData) {
    return store
  }

  return {
    ...store,
    [itemId]: {
      id: itemId,
      data: nextData
    }
  }
}

const safeJson = (value: unknown) => {
  try {
    return JSON.stringify(value, (_key, candidate) =>
      typeof candidate === 'bigint' ? String(candidate) : candidate, 2
    )
  } catch {
    return String(value)
  }
}

const statusFromProtocol = (status: string): ToolItemPresentationStatus => {
  if (status === 'inProgress') {
    return 'running'
  }
  if (status === 'failed' || status === 'declined') {
    return status
  }
  return 'completed'
}

const boundedToolText = (text: string, maximumCharacters: number) => {
  const normalized = text.trim()
  if (normalized.length <= maximumCharacters) {
    return {
      text: normalized,
      truncated: false
    }
  }
  const available = Math.max(
    0,
    maximumCharacters - TOOL_OUTPUT_TRUNCATION_MARKER.length
  )
  return {
    text: `${TOOL_OUTPUT_TRUNCATION_MARKER}${normalized.slice(-available)}`,
    truncated: true
  }
}

const joinSections = (
  sections: Array<[label: string, value: string | null | undefined]>
) => sections
  .filter((section): section is [string, string] => Boolean(section[1]?.trim()))
  .map(([label, value]) => `${label}\n${value.trim()}`)
  .join('\n\n')

export const normalizeToolItemPresentation = (
  data: ItemData,
  options: {
    maximumCharacters?: number
  } = {}
): ToolItemPresentation | null => {
  if (data.kind === 'subagent_activity' || data.kind === 'context_compaction') {
    return null
  }

  const maximumCharacters = Math.max(
    TOOL_OUTPUT_TRUNCATION_MARKER.length,
    Math.floor(options.maximumCharacters ?? DEFAULT_TOOL_OUTPUT_CHARACTER_LIMIT)
  )
  let title: string
  let status: ToolItemPresentationStatus
  let output = ''
  let processId: string | null = null
  let cwd: string | null = null
  let exitCode: number | null = null

  switch (data.kind) {
    case 'command_execution':
      title = data.item.command || 'Command'
      status = statusFromProtocol(data.item.status)
      processId = data.item.processId
      cwd = data.item.cwd || null
      exitCode = data.item.exitCode
      output = joinSections([
        ['Output', data.item.aggregatedOutput],
        ['Exit', data.item.exitCode === null ? null : `Exit code ${data.item.exitCode}`]
      ])
      break
    case 'file_change':
      title = data.item.changes[0]?.path || 'File changes'
      status = statusFromProtocol(data.item.status)
      output = joinSections([
        ['Progress', data.liveOutput],
        ['Changes', data.item.changes.map(change =>
          `${change.kind.type.toUpperCase()} ${change.path}\n${change.diff}`
        ).join('\n\n')]
      ])
      break
    case 'mcp_tool_call':
      title = `${data.item.server} ${data.item.tool}`.trim()
      status = statusFromProtocol(data.item.status)
      output = joinSections([
        ['Arguments', data.item.arguments === null ? null : safeJson(data.item.arguments)],
        ['Progress', data.progressMessages?.join('\n')],
        ['Result', data.item.result ? safeJson(data.item.result) : null],
        ['Error', data.item.error?.message]
      ])
      break
    case 'dynamic_tool_call':
      title = [data.item.namespace, data.item.tool].filter(Boolean).join('/') || 'Internal tool'
      status = statusFromProtocol(data.item.status)
      output = joinSections([
        ['Input', data.item.contentItems?.map((entry) => {
          if (entry.type === 'inputText') {
            return entry.text
          }
          return entry.type === 'inputImage' ? '[image]' : '[audio]'
        }).join('\n')],
        ['Arguments', data.item.arguments === null ? null : safeJson(data.item.arguments)],
        ['Progress', data.progressMessages?.join('\n')],
        ['Result', data.item.success === null
          ? null
          : data.item.success ? 'Completed successfully.' : 'Reported failure.']
      ])
      break
    case 'web_search':
      title = data.item.query || 'Web search'
      status = statusFromProtocol(data.status)
      output = joinSections([
        ['Action', data.item.action ? safeJson(data.item.action) : null],
        ['Results', data.item.results ? safeJson(data.item.results) : null]
      ])
  }

  const bounded = boundedToolText(output, maximumCharacters)
  return {
    id: data.item.id,
    kind: data.kind,
    title,
    status,
    text: bounded.text,
    processId,
    cwd,
    exitCode,
    truncated: bounded.truncated
  }
}

export const normalizeToolItemPresentations = (
  store: ToolItemStore,
  options: {
    maximumCharacters?: number
  } = {}
) => Object.values(store)
  .map(entry => normalizeToolItemPresentation(entry.data, options))
  .filter((entry): entry is ToolItemPresentation => entry !== null)

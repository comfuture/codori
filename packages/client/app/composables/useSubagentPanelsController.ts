import { ref, type Ref } from 'vue'
import type { LiveStream, SubagentPanelState } from './useChatSession'
import {
  ITEM_PART,
  eventToMessage,
  isSubagentActiveStatus,
  itemToMessages,
  replaceStreamingMessage,
  threadToMessages,
  upsertStreamingMessage,
  type ChatMessage,
  type ChatPart,
  type FileChangeItem,
  type ItemData,
  type McpToolCallItem
} from '~~/shared/codex-chat'
import {
  notificationTurnId,
  type CodexRpcNotification,
  type CodexThread,
  type CodexThreadItem,
  type ThreadReadResponse
} from '~~/shared/codex-rpc'

type ThreadReadClient = {
  request<T>(method: 'thread/read', params: { threadId: string, includeTurns: true }): Promise<T>
}

type UseSubagentPanelsControllerOptions = {
  projectId: string
  subagentPanels: Ref<SubagentPanelState[]>
  ensureProjectRuntime: () => Promise<void>
  getClient: (projectId: string) => ThreadReadClient
  isActiveTurnStatus: (value: string | null | undefined) => boolean
  currentLiveStream: () => LiveStream | null
}

const shortThreadId = (value: string) => value.slice(0, 8)

const resolveSubagentName = (
  threadId: string,
  thread?: Pick<CodexThread, 'agentNickname' | 'name' | 'preview'> | null
) => {
  const candidate = thread?.agentNickname?.trim()
    || thread?.name?.trim()
    || thread?.preview?.trim()

  if (candidate) {
    return candidate
  }

  return `Agent ${shortThreadId(threadId)}`
}

const isTextPart = (part: ChatPart): part is Extract<ChatPart, { type: 'text' }> =>
  part.type === 'text'

const isItemPart = (part: ChatPart): part is Extract<ChatPart, { type: typeof ITEM_PART }> =>
  part.type === ITEM_PART

const getFallbackItemData = (message: ChatMessage) => {
  const itemPart = message.parts.find(isItemPart)
  if (!itemPart) {
    throw new Error('Expected item part in fallback message.')
  }

  return itemPart.data
}

const fallbackCommandMessage = (itemId: string): ChatMessage => ({
  id: itemId,
  role: 'system',
  pending: true,
  parts: [{
    type: ITEM_PART,
    data: {
      kind: 'command_execution',
      item: {
        type: 'commandExecution',
        id: itemId,
        command: 'Command',
        aggregatedOutput: '',
        exitCode: null,
        status: 'inProgress'
      }
    }
  }]
})

const fallbackFileChangeMessage = (itemId: string): ChatMessage => ({
  id: itemId,
  role: 'system',
  pending: true,
  parts: [{
    type: ITEM_PART,
    data: {
      kind: 'file_change',
      item: {
        type: 'fileChange',
        id: itemId,
        changes: [],
        status: 'inProgress',
        liveOutput: ''
      }
    }
  }]
})

const fallbackMcpToolMessage = (itemId: string): ChatMessage => ({
  id: itemId,
  role: 'system',
  pending: true,
  parts: [{
    type: ITEM_PART,
    data: {
      kind: 'mcp_tool_call',
      item: {
        type: 'mcpToolCall',
        id: itemId,
        server: 'mcp',
        tool: 'tool',
        arguments: null,
        result: null,
        error: null,
        status: 'inProgress',
        progressMessages: []
      }
    }
  }]
})

const fallbackCommandItemData = (itemId: string) =>
  getFallbackItemData(fallbackCommandMessage(itemId)) as Extract<ItemData, { kind: 'command_execution' }>

const fallbackFileChangeItemData = (itemId: string) =>
  getFallbackItemData(fallbackFileChangeMessage(itemId)) as Extract<ItemData, { kind: 'file_change' }>

const fallbackMcpToolItemData = (itemId: string) =>
  getFallbackItemData(fallbackMcpToolMessage(itemId)) as Extract<ItemData, { kind: 'mcp_tool_call' }>

export const useSubagentPanelsController = (options: UseSubagentPanelsControllerOptions) => {
  const subagentBootstrapPromises = new Map<string, Promise<void>>()

  const getSubagentPanel = (threadId: string) =>
    options.subagentPanels.value.find(panel => panel.threadId === threadId)

  const createSubagentPanelState = (threadId: string): SubagentPanelState => ({
    threadId,
    name: resolveSubagentName(threadId),
    role: null,
    status: null,
    messages: [],
    firstSeenAt: Date.now(),
    lastSeenAt: Date.now(),
    turnId: null,
    bootstrapped: false,
    bufferedNotifications: []
  })

  const upsertSubagentPanel = (
    threadId: string,
    updater: (panel: SubagentPanelState | undefined) => SubagentPanelState
  ) => {
    const current = getSubagentPanel(threadId)
    const nextPanel = updater(current)
    const index = options.subagentPanels.value.findIndex(panel => panel.threadId === threadId)

    if (index === -1) {
      options.subagentPanels.value = [...options.subagentPanels.value, nextPanel]
      return nextPanel
    }

    options.subagentPanels.value = options.subagentPanels.value.map((panel, panelIndex) =>
      panelIndex === index ? nextPanel : panel
    )
    return nextPanel
  }

  const rememberObservedSubagentThread = (threadId: string) => {
    options.currentLiveStream()?.observedSubagentThreadIds.add(threadId)
  }

  const updateSubagentPanelMessages = (
    threadId: string,
    updater: (panelMessages: ChatMessage[]) => ChatMessage[]
  ) => {
    upsertSubagentPanel(threadId, (panel) => {
      const basePanel = panel ?? createSubagentPanelState(threadId)
      return {
        ...basePanel,
        messages: updater(basePanel.messages),
        lastSeenAt: Date.now()
      }
    })
  }

  const updateSubagentMessage = (
    threadId: string,
    messageId: string,
    fallbackMessage: ChatMessage,
    transform: (message: ChatMessage) => ChatMessage
  ) => {
    updateSubagentPanelMessages(threadId, (panelMessages) => {
      const existing = panelMessages.find(message => message.id === messageId)
      return upsertStreamingMessage(panelMessages, transform(existing ?? fallbackMessage))
    })
  }

  const appendSubagentTextPartDelta = (
    threadId: string,
    messageId: string,
    delta: string,
    fallbackMessage: ChatMessage
  ) => {
    updateSubagentMessage(threadId, messageId, fallbackMessage, (message) => {
      const partIndex = message.parts.findIndex(isTextPart)
      const existingTextPart = partIndex === -1 ? null : message.parts[partIndex] as Extract<ChatPart, { type: 'text' }>
      const nextText = existingTextPart ? `${existingTextPart.text}${delta}` : delta
      const nextTextPart: Extract<ChatPart, { type: 'text' }> = {
        type: 'text',
        text: nextText,
        state: 'streaming'
      }
      const nextParts = partIndex === -1
        ? [...message.parts, nextTextPart]
        : message.parts.map((part, index) => index === partIndex ? nextTextPart : part)

      return {
        ...message,
        pending: true,
        parts: nextParts
      }
    })
  }

  const updateSubagentItemPart = (
    threadId: string,
    messageId: string,
    fallbackMessage: ChatMessage,
    transform: (itemData: ItemData) => ItemData
  ) => {
    updateSubagentMessage(threadId, messageId, fallbackMessage, (message) => {
      const partIndex = message.parts.findIndex(isItemPart)
      const existingData = partIndex === -1 ? null : (message.parts[partIndex] as Extract<ChatPart, { type: typeof ITEM_PART }>).data
      const nextData = transform(existingData ?? getFallbackItemData(fallbackMessage))
      const nextPart: Extract<ChatPart, { type: typeof ITEM_PART }> = {
        type: ITEM_PART,
        data: nextData
      }
      const nextParts = partIndex === -1
        ? [...message.parts, nextPart]
        : message.parts.map((part, index) => index === partIndex ? nextPart : part)

      return {
        ...message,
        pending: true,
        parts: nextParts
      }
    })
  }

  const pushSubagentEventMessage = (threadId: string, kind: 'turn.failed' | 'stream.error', messageText: string) => {
    updateSubagentPanelMessages(threadId, (panelMessages) =>
      upsertStreamingMessage(
        panelMessages,
        eventToMessage(`subagent-event-${threadId}-${kind}-${Date.now()}`, kind === 'turn.failed'
          ? {
              kind,
              error: {
                message: messageText
              }
            }
          : {
              kind,
              message: messageText
            })
      )
    )
  }

  const seedSubagentStreamingMessage = (threadId: string, item: CodexThreadItem) => {
    const [seed] = itemToMessages(item)
    if (!seed) {
      return
    }

    updateSubagentPanelMessages(threadId, (panelMessages) =>
      upsertStreamingMessage(panelMessages, {
        ...seed,
        pending: true
      })
    )
  }

  const bootstrapSubagentPanel = async (threadId: string) => {
    if (!threadId) {
      return
    }

    const existingPromise = subagentBootstrapPromises.get(threadId)
    if (existingPromise) {
      await existingPromise
      return
    }

    const bootstrapPromise = (async () => {
      try {
        await options.ensureProjectRuntime()
        const client = options.getClient(options.projectId)
        const response = await client.request<ThreadReadResponse>('thread/read', {
          threadId,
          includeTurns: true
        })
        const activeTurn = [...response.thread.turns].reverse().find(turn => options.isActiveTurnStatus(turn.status))
        const pendingNotifications = getSubagentPanel(threadId)?.bufferedNotifications.slice() ?? []

        upsertSubagentPanel(threadId, (panel) => {
          const basePanel = panel ?? createSubagentPanelState(threadId)
          return {
            ...basePanel,
            name: resolveSubagentName(threadId, response.thread),
            role: response.thread.agentRole ?? basePanel.role ?? null,
            messages: threadToMessages(response.thread),
            turnId: activeTurn?.id ?? null,
            bootstrapped: true,
            bufferedNotifications: [],
            status: panel?.status
              ?? (activeTurn ? 'running' : basePanel.status)
              ?? null,
            lastSeenAt: Date.now()
          }
        })

        for (const notification of pendingNotifications) {
          applySubagentNotification(threadId, notification)
        }
      } catch {
        upsertSubagentPanel(threadId, (panel) => ({
          ...(panel ?? createSubagentPanelState(threadId)),
          lastSeenAt: Date.now()
        }))
      } finally {
        subagentBootstrapPromises.delete(threadId)
      }
    })()

    subagentBootstrapPromises.set(threadId, bootstrapPromise)
    await bootstrapPromise
  }

  const applySubagentActivityItem = (item: Extract<CodexThreadItem, { type: 'collabAgentToolCall' }>) => {
    const orderedThreadIds = [
      ...item.receiverThreadIds,
      ...Object.keys(item.agentsStates).filter(threadId => !item.receiverThreadIds.includes(threadId))
    ]

    for (const threadId of orderedThreadIds) {
      const agentState = item.agentsStates[threadId]
      rememberObservedSubagentThread(threadId)
      upsertSubagentPanel(threadId, (panel) => {
        const basePanel = panel ?? createSubagentPanelState(threadId)
        return {
          ...basePanel,
          status: agentState?.status ?? basePanel.status,
          lastSeenAt: Date.now()
        }
      })
    }

    for (const threadId of orderedThreadIds) {
      void bootstrapSubagentPanel(threadId)
    }
  }

  const rebuildSubagentPanelsFromThread = (thread: CodexThread) => {
    options.subagentPanels.value = []
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        if (item.type === 'collabAgentToolCall') {
          applySubagentActivityItem(item)
        }
      }
    }
  }

  const applySubagentNotification = (threadId: string, notification: CodexRpcNotification) => {
    const panel = getSubagentPanel(threadId)
    if (!panel) {
      return
    }

    if (!panel.bootstrapped) {
      upsertSubagentPanel(threadId, (existingPanel) => ({
        ...(existingPanel ?? createSubagentPanelState(threadId)),
        bufferedNotifications: [...(existingPanel?.bufferedNotifications ?? []), notification],
        lastSeenAt: Date.now()
      }))
      return
    }

    const turnId = notificationTurnId(notification)
    if (panel.turnId && turnId && turnId !== panel.turnId && notification.method !== 'turn/started') {
      return
    }

    switch (notification.method) {
      case 'turn/started': {
        upsertSubagentPanel(threadId, (existingPanel) => ({
          ...(existingPanel ?? createSubagentPanelState(threadId)),
          turnId: notificationTurnId(notification),
          status: existingPanel?.status === 'completed' ? existingPanel.status : 'running',
          lastSeenAt: Date.now()
        }))
        return
      }
      case 'item/started': {
        const params = notification.params as { item: CodexThreadItem }
        if (params.item.type === 'collabAgentToolCall') {
          applySubagentActivityItem(params.item)
        }
        seedSubagentStreamingMessage(threadId, params.item)
        return
      }
      case 'item/completed': {
        const params = notification.params as { item: CodexThreadItem }
        if (params.item.type === 'collabAgentToolCall') {
          applySubagentActivityItem(params.item)
        }
        for (const nextMessage of itemToMessages(params.item)) {
          updateSubagentPanelMessages(threadId, (panelMessages) =>
            replaceStreamingMessage(panelMessages, {
              ...nextMessage,
              pending: false
            })
          )
        }
        return
      }
      case 'item/agentMessage/delta':
      case 'item/plan/delta': {
        const params = notification.params as { itemId: string, delta: string }
        appendSubagentTextPartDelta(threadId, params.itemId, params.delta, {
          id: params.itemId,
          role: 'assistant',
          pending: true,
          parts: [{
            type: 'text',
            text: '',
            state: 'streaming'
          }]
        })
        return
      }
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const params = notification.params as { itemId: string, delta: string }
        updateSubagentMessage(threadId, params.itemId, {
          id: params.itemId,
          role: 'assistant',
          pending: true,
          parts: [{
            type: 'reasoning',
            summary: [],
            content: [],
            state: 'streaming'
          }]
        }, (message) => {
          const partIndex = message.parts.findIndex(part => part.type === 'reasoning')
          const existingPart = partIndex === -1
            ? {
                type: 'reasoning' as const,
                summary: [],
                content: []
              }
            : message.parts[partIndex] as Extract<ChatPart, { type: 'reasoning' }>
          const nextPart: Extract<ChatPart, { type: 'reasoning' }> = {
            type: 'reasoning',
            summary: notification.method === 'item/reasoning/summaryTextDelta'
              ? [...existingPart.summary, params.delta]
              : existingPart.summary,
            content: notification.method === 'item/reasoning/textDelta'
              ? [...existingPart.content, params.delta]
              : existingPart.content,
            state: 'streaming'
          }
          const nextParts = partIndex === -1
            ? [...message.parts, nextPart]
            : message.parts.map((part, index) => index === partIndex ? nextPart : part)

          return {
            ...message,
            pending: true,
            parts: nextParts
          }
        })
        return
      }
      case 'item/commandExecution/outputDelta': {
        const params = notification.params as { itemId: string, delta: string }
        const fallbackItem = fallbackCommandItemData(params.itemId)
        updateSubagentItemPart(threadId, params.itemId, fallbackCommandMessage(params.itemId), (itemData) => ({
          kind: 'command_execution',
          item: {
            ...(itemData.kind === 'command_execution' ? itemData.item : fallbackItem.item),
            aggregatedOutput: `${(itemData.kind === 'command_execution' ? itemData.item.aggregatedOutput : '') ?? ''}${params.delta}`,
            status: 'inProgress'
          }
        }))
        return
      }
      case 'item/fileChange/outputDelta': {
        const params = notification.params as { itemId: string, delta: string }
        const fallbackItem = fallbackFileChangeItemData(params.itemId)
        updateSubagentItemPart(threadId, params.itemId, fallbackFileChangeMessage(params.itemId), (itemData) => {
          const baseItem: FileChangeItem = itemData.kind === 'file_change'
            ? itemData.item
            : fallbackItem.item
          return {
            kind: 'file_change',
            item: {
              ...baseItem,
              liveOutput: `${baseItem.liveOutput ?? ''}${params.delta}`,
              status: 'inProgress'
            }
          }
        })
        return
      }
      case 'item/mcpToolCall/progress': {
        const params = notification.params as { itemId: string, message: string }
        const fallbackItem = fallbackMcpToolItemData(params.itemId)
        updateSubagentItemPart(threadId, params.itemId, fallbackMcpToolMessage(params.itemId), (itemData) => {
          const baseItem: McpToolCallItem = itemData.kind === 'mcp_tool_call'
            ? itemData.item
            : fallbackItem.item
          return {
            kind: 'mcp_tool_call',
            item: {
              ...baseItem,
              progressMessages: [...(baseItem.progressMessages ?? []), params.message],
              status: 'inProgress'
            }
          }
        })
        return
      }
      case 'turn/completed': {
        upsertSubagentPanel(threadId, (existingPanel) => ({
          ...(existingPanel ?? createSubagentPanelState(threadId)),
          turnId: null,
          status: isSubagentActiveStatus(existingPanel?.status ?? null)
            ? 'completed'
            : existingPanel?.status ?? null,
          lastSeenAt: Date.now()
        }))
        return
      }
      case 'turn/failed': {
        const params = notification.params as { error?: { message?: string } }
        const messageText = params.error?.message ?? 'The turn failed.'
        pushSubagentEventMessage(threadId, 'turn.failed', messageText)
        upsertSubagentPanel(threadId, (existingPanel) => ({
          ...(existingPanel ?? createSubagentPanelState(threadId)),
          status: 'errored',
          turnId: null,
          lastSeenAt: Date.now()
        }))
        return
      }
      case 'stream/error': {
        const params = notification.params as { message?: string }
        const messageText = params.message ?? 'The stream failed.'
        pushSubagentEventMessage(threadId, 'stream.error', messageText)
        upsertSubagentPanel(threadId, (existingPanel) => ({
          ...(existingPanel ?? createSubagentPanelState(threadId)),
          status: 'errored',
          turnId: null,
          lastSeenAt: Date.now()
        }))
        return
      }
      default:
        return
    }
  }

  return {
    getSubagentPanel,
    createSubagentPanelState,
    upsertSubagentPanel,
    rememberObservedSubagentThread,
    bootstrapSubagentPanel,
    applySubagentActivityItem,
    rebuildSubagentPanelsFromThread,
    applySubagentNotification
  }
}

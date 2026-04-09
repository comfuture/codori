<script setup lang="ts">
import { useRouter } from '#imports'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import CdMessageContent from './message-content.vue'
import { useCodoriChatSession } from '../../composables/useCodoriChatSession.js'
import { useCodoriProjects } from '../../composables/useCodoriProjects.js'
import { useCodoriRpc } from '../../composables/useCodoriRpc.js'
import { useChatSubmitGuard } from '../../composables/useChatSubmitGuard.js'
import {
  CODORI_ITEM_PART,
  eventToMessage,
  itemToMessages,
  threadToMessages,
  upsertStreamingMessage,
  type CodoriChatMessage,
  type CodoriChatPart,
  type CodoriFileChangeItem,
  type CodoriItemData,
  type CodoriMcpToolCallItem
} from '~~/shared/codex-chat.js'
import {
  notificationThreadId,
  notificationTurnId,
  type CodexRpcNotification,
  type CodexThreadItem,
  type ThreadReadResponse,
  type ThreadResumeResponse,
  type ThreadStartResponse,
  type TurnStartResponse
} from '~~/shared/codex-rpc.js'
import { toProjectThreadRoute } from '~~/shared/codori.js'

const props = defineProps<{
  projectId: string
  threadId?: string | null
}>()

const router = useRouter()
const { getClient } = useCodoriRpc()
const {
  loaded,
  refreshProjects,
  getProject,
  startProject
} = useCodoriProjects()
const {
  onCompositionStart,
  onCompositionEnd,
  shouldSubmit
} = useChatSubmitGuard()

const input = ref('')
const scrollViewport = ref<HTMLElement | null>(null)
const pinnedToBottom = ref(true)
const session = useCodoriChatSession(props.projectId)
const {
  messages,
  status,
  error,
  activeThreadId,
  pendingThreadId,
  autoRedirectThreadId,
  loadVersion
} = session

const selectedProject = computed(() => getProject(props.projectId))
const submitError = computed(() => error.value ? new Error(error.value) : undefined)
const isBusy = computed(() => status.value === 'submitted' || status.value === 'streaming')
const routeThreadId = computed(() => props.threadId ?? null)

const isActiveTurnStatus = (value: string | null | undefined) => {
  if (!value) {
    return false
  }

  return !/(completed|failed|error|cancelled|canceled|interrupted|stopped)/i.test(value)
}

const currentLiveStream = () =>
  session.liveStream?.threadId === activeThreadId.value
    ? session.liveStream
    : null

const clearLiveStream = () => {
  session.liveStream?.unsubscribe?.()
  session.liveStream = null
}

const isTextPart = (part: CodoriChatPart): part is Extract<CodoriChatPart, { type: 'text' }> =>
  part.type === 'text'

const isItemPart = (part: CodoriChatPart): part is Extract<CodoriChatPart, { type: typeof CODORI_ITEM_PART }> =>
  part.type === CODORI_ITEM_PART

const getFallbackItemData = (message: CodoriChatMessage) => {
  const itemPart = message.parts.find(isItemPart)
  if (!itemPart) {
    throw new Error('Expected fallback item part.')
  }

  return itemPart.data
}

const updatePinnedState = () => {
  const viewport = scrollViewport.value
  if (!viewport) {
    return
  }

  pinnedToBottom.value = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 80
}

const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
  const viewport = scrollViewport.value
  if (!viewport) {
    return
  }

  viewport.scrollTo({
    top: viewport.scrollHeight,
    behavior
  })
}

const scheduleScrollToBottom = async (behavior: ScrollBehavior = 'auto') => {
  await nextTick()

  if (!import.meta.client) {
    scrollToBottom(behavior)
    return
  }

  requestAnimationFrame(() => {
    if (pinnedToBottom.value || isBusy.value) {
      scrollToBottom(behavior)
    }
  })
}

const ensureProjectRuntime = async () => {
  if (!loaded.value) {
    await refreshProjects()
  }

  if (selectedProject.value?.status === 'running') {
    return
  }

  await startProject(props.projectId)
}

const hydrateThread = async (threadId: string) => {
  const requestVersion = loadVersion.value + 1
  loadVersion.value = requestVersion
  error.value = null

  try {
    await ensureProjectRuntime()
    const client = getClient(props.projectId)
    activeThreadId.value = threadId

    const existingLiveStream = currentLiveStream()

    if (!existingLiveStream) {
      const nextLiveStream = {
        threadId,
        turnId: null,
        bufferedNotifications: [] as CodexRpcNotification[],
        unsubscribe: null as (() => void) | null
      }

      nextLiveStream.unsubscribe = client.subscribe((notification) => {
        if (notificationThreadId(notification) !== threadId) {
          return
        }

        if (!nextLiveStream.turnId) {
          nextLiveStream.bufferedNotifications.push(notification)
          return
        }

        const turnId = notificationTurnId(notification)
        if (turnId && turnId !== nextLiveStream.turnId) {
          return
        }

        applyNotification(notification)
      })

      session.liveStream = nextLiveStream
    }

    await client.request<ThreadResumeResponse>('thread/resume', {
      threadId,
      cwd: selectedProject.value?.projectPath ?? null,
      approvalPolicy: 'never',
      persistExtendedHistory: true
    })
    const response = await client.request<ThreadReadResponse>('thread/read', {
      threadId,
      includeTurns: true
    })

    if (loadVersion.value !== requestVersion) {
      return
    }

    activeThreadId.value = response.thread.id
    messages.value = threadToMessages(response.thread)
    const activeTurn = [...response.thread.turns].reverse().find(turn => isActiveTurnStatus(turn.status))

    if (!activeTurn) {
      clearLiveStream()
      status.value = 'ready'
      return
    }

    if (!session.liveStream) {
      status.value = 'streaming'
      return
    }

    session.liveStream.turnId = activeTurn.id
    status.value = 'streaming'

    const pendingNotifications = session.liveStream.bufferedNotifications.splice(0, session.liveStream.bufferedNotifications.length)
    for (const notification of pendingNotifications) {
      const turnId = notificationTurnId(notification)
      if (turnId && turnId !== activeTurn.id) {
        continue
      }

      applyNotification(notification)
    }
  } catch (caughtError) {
    clearLiveStream()
    error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    status.value = 'error'
  }
}

const resetDraftThread = () => {
  clearLiveStream()
  activeThreadId.value = null
  pendingThreadId.value = null
  autoRedirectThreadId.value = null
  messages.value = []
  error.value = null
  status.value = 'ready'
}

const ensureThread = async () => {
  if (activeThreadId.value) {
    return {
      threadId: activeThreadId.value,
      created: false
    }
  }

  await ensureProjectRuntime()
  const client = getClient(props.projectId)
  const response = await client.request<ThreadStartResponse>('thread/start', {
    cwd: selectedProject.value?.projectPath ?? null,
    approvalPolicy: 'never',
    experimentalRawEvents: false,
    persistExtendedHistory: true
  })

  activeThreadId.value = response.thread.id
  return {
    threadId: response.thread.id,
    created: true
  }
}

const seedStreamingMessage = (item: CodexThreadItem) => {
  const [seed] = itemToMessages(item)
  if (!seed) {
    return
  }

  messages.value = upsertStreamingMessage(messages.value, {
    ...seed,
    pending: true
  })
}

const updateMessage = (
  messageId: string,
  fallbackMessage: CodoriChatMessage,
  transform: (message: CodoriChatMessage) => CodoriChatMessage
) => {
  const existing = messages.value.find(message => message.id === messageId)
  messages.value = upsertStreamingMessage(messages.value, transform(existing ?? fallbackMessage))
}

const appendTextPartDelta = (
  messageId: string,
  delta: string,
  fallbackMessage: CodoriChatMessage
) => {
  updateMessage(messageId, fallbackMessage, (message) => {
    const partIndex = message.parts.findIndex(isTextPart)
    const existingTextPart = partIndex === -1 ? null : message.parts[partIndex] as Extract<CodoriChatPart, { type: 'text' }>
    const nextText = existingTextPart ? `${existingTextPart.text}${delta}` : delta
    const nextTextPart: Extract<CodoriChatPart, { type: 'text' }> = {
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

const updateItemPart = (
  messageId: string,
  fallbackMessage: CodoriChatMessage,
  transform: (itemData: CodoriItemData) => CodoriItemData
) => {
  updateMessage(messageId, fallbackMessage, (message) => {
    const partIndex = message.parts.findIndex(isItemPart)
    const existingData = partIndex === -1 ? null : (message.parts[partIndex] as Extract<CodoriChatPart, { type: typeof CODORI_ITEM_PART }>).data
    const nextData = transform(existingData ?? getFallbackItemData(fallbackMessage))
    const nextPart: Extract<CodoriChatPart, { type: typeof CODORI_ITEM_PART }> = {
      type: CODORI_ITEM_PART,
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

const fallbackCommandMessage = (itemId: string): CodoriChatMessage => ({
  id: itemId,
  role: 'system',
  pending: true,
  parts: [{
    type: CODORI_ITEM_PART,
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

const fallbackFileChangeMessage = (itemId: string): CodoriChatMessage => ({
  id: itemId,
  role: 'system',
  pending: true,
  parts: [{
    type: CODORI_ITEM_PART,
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

const fallbackMcpToolMessage = (itemId: string): CodoriChatMessage => ({
  id: itemId,
  role: 'system',
  pending: true,
  parts: [{
    type: CODORI_ITEM_PART,
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
  getFallbackItemData(fallbackCommandMessage(itemId)) as Extract<CodoriItemData, { kind: 'command_execution' }>

const fallbackFileChangeItemData = (itemId: string) =>
  getFallbackItemData(fallbackFileChangeMessage(itemId)) as Extract<CodoriItemData, { kind: 'file_change' }>

const fallbackMcpToolItemData = (itemId: string) =>
  getFallbackItemData(fallbackMcpToolMessage(itemId)) as Extract<CodoriItemData, { kind: 'mcp_tool_call' }>

const pushEventMessage = (kind: 'turn.failed' | 'stream.error', messageText: string) => {
  messages.value = upsertStreamingMessage(
    messages.value,
    eventToMessage(`event-${kind}-${Date.now()}`, kind === 'turn.failed'
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
}

const applyNotification = (notification: CodexRpcNotification) => {
  switch (notification.method) {
    case 'thread/started': {
      const nextThreadId = notificationThreadId(notification)
      if (!nextThreadId) {
        return
      }

      activeThreadId.value = nextThreadId
      pendingThreadId.value = pendingThreadId.value ?? nextThreadId
      return
    }
    case 'turn/started': {
      messages.value = upsertStreamingMessage(
        messages.value,
        eventToMessage(`event-turn-started-${notificationTurnId(notification) ?? Date.now()}`, {
          kind: 'turn.started'
        })
      )
      status.value = 'streaming'
      return
    }
    case 'item/started': {
      const params = notification.params as { item: CodexThreadItem }
      seedStreamingMessage(params.item)
      status.value = 'streaming'
      return
    }
    case 'item/completed': {
      const params = notification.params as { item: CodexThreadItem }
      for (const nextMessage of itemToMessages(params.item)) {
        messages.value = upsertStreamingMessage(messages.value, {
          ...nextMessage,
          pending: false
        })
      }
      return
    }
    case 'item/agentMessage/delta': {
      const params = notification.params as { itemId: string, delta: string }
      appendTextPartDelta(params.itemId, params.delta, {
        id: params.itemId,
        role: 'assistant',
        pending: true,
        parts: [{
          type: 'text',
          text: '',
          state: 'streaming'
        }]
      })
      status.value = 'streaming'
      return
    }
    case 'item/plan/delta': {
      const params = notification.params as { itemId: string, delta: string }
      appendTextPartDelta(params.itemId, params.delta, {
        id: params.itemId,
        role: 'assistant',
        pending: true,
        parts: [{
          type: 'text',
          text: '',
          state: 'streaming'
        }]
      })
      status.value = 'streaming'
      return
    }
    case 'item/reasoning/textDelta':
    case 'item/reasoning/summaryTextDelta': {
      const params = notification.params as { itemId: string, delta: string }
      updateMessage(params.itemId, {
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
          : message.parts[partIndex] as Extract<CodoriChatPart, { type: 'reasoning' }>
        const nextPart: Extract<CodoriChatPart, { type: 'reasoning' }> = {
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
      status.value = 'streaming'
      return
    }
    case 'item/commandExecution/outputDelta': {
      const params = notification.params as { itemId: string, delta: string }
      const fallbackItem = fallbackCommandItemData(params.itemId)
      updateItemPart(params.itemId, fallbackCommandMessage(params.itemId), (itemData) => ({
        kind: 'command_execution',
        item: {
          ...(itemData.kind === 'command_execution' ? itemData.item : fallbackItem.item),
          aggregatedOutput: `${(itemData.kind === 'command_execution' ? itemData.item.aggregatedOutput : '') ?? ''}${params.delta}`,
          status: 'inProgress'
        }
      }))
      status.value = 'streaming'
      return
    }
    case 'item/fileChange/outputDelta': {
      const params = notification.params as { itemId: string, delta: string }
      const fallbackItem = fallbackFileChangeItemData(params.itemId)
      updateItemPart(params.itemId, fallbackFileChangeMessage(params.itemId), (itemData) => {
        const baseItem: CodoriFileChangeItem = itemData.kind === 'file_change'
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
      status.value = 'streaming'
      return
    }
    case 'item/mcpToolCall/progress': {
      const params = notification.params as { itemId: string, message: string }
      const fallbackItem = fallbackMcpToolItemData(params.itemId)
      updateItemPart(params.itemId, fallbackMcpToolMessage(params.itemId), (itemData) => {
        const baseItem: CodoriMcpToolCallItem = itemData.kind === 'mcp_tool_call'
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
      status.value = 'streaming'
      return
    }
    case 'turn/failed': {
      const params = notification.params as { error?: { message?: string } }
      const messageText = params.error?.message ?? 'The turn failed.'
      pushEventMessage('turn.failed', messageText)
      clearLiveStream()
      error.value = messageText
      status.value = 'error'
      return
    }
    case 'stream/error': {
      const params = notification.params as { message?: string }
      const messageText = params.message ?? 'The stream failed.'
      pushEventMessage('stream.error', messageText)
      clearLiveStream()
      error.value = messageText
      status.value = 'error'
      return
    }
    case 'turn/completed': {
      status.value = 'ready'
      clearLiveStream()
      return
    }
    default:
      return
  }
}

const sendMessage = async () => {
  const text = input.value.trim()
  if (!text) {
    return
  }

  pinnedToBottom.value = true
  error.value = null
  status.value = 'submitted'
  input.value = ''

  const optimisticMessage: CodoriChatMessage = {
    id: `local-user-${Date.now()}`,
    role: 'user',
    parts: [{
      type: 'text',
      text,
      state: 'done'
    }]
  }
  messages.value = [...messages.value, optimisticMessage]
  let unsubscribe: (() => void) | null = null

  try {
    await ensureProjectRuntime()
    const { threadId, created } = await ensureThread()
    const client = getClient(props.projectId)
    const buffered: CodexRpcNotification[] = []
    let currentTurnId: string | null = null
    let completionResolved = false
    let resolveCompletion: (() => void) | null = null
    let rejectCompletion: ((error: Error) => void) | null = null

    const settleNotification = (notification: CodexRpcNotification) => {
      if (notificationThreadId(notification) !== threadId) {
        return false
      }

      const turnId = notificationTurnId(notification)
      if (currentTurnId && turnId && turnId !== currentTurnId) {
        return false
      }

      if (notification.method === 'error') {
        completionResolved = true
        unsubscribe?.()
        if (session.liveStream?.unsubscribe === unsubscribe) {
          session.liveStream = null
        }
        const params = notification.params as { error?: { message?: string } }
        const messageText = params.error?.message ?? 'Turn failed.'
        pushEventMessage('stream.error', messageText)
        rejectCompletion?.(new Error(messageText))
        return true
      }

      applyNotification(notification)

      if (notification.method === 'turn/completed') {
        completionResolved = true
        unsubscribe?.()
        if (session.liveStream?.unsubscribe === unsubscribe) {
          session.liveStream = null
        }
        resolveCompletion?.()
        return true
      }

      if (notification.method === 'turn/failed' || notification.method === 'stream/error') {
        completionResolved = true
        unsubscribe?.()
        if (session.liveStream?.unsubscribe === unsubscribe) {
          session.liveStream = null
        }
        rejectCompletion?.(new Error(error.value ?? 'Turn failed.'))
        return true
      }

      return false
    }

    clearLiveStream()

    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = (caughtError: Error) => reject(caughtError)
    })

    const liveStream = {
      threadId,
      turnId: null as string | null,
      bufferedNotifications: buffered,
      unsubscribe: null as (() => void) | null
    }

    unsubscribe = client.subscribe((notification) => {
      if (notificationThreadId(notification) !== threadId) {
        return
      }

      if (!currentTurnId) {
        buffered.push(notification)
        return
      }

      settleNotification(notification)
    })
    liveStream.unsubscribe = unsubscribe
    session.liveStream = liveStream

    if (created && !routeThreadId.value) {
      pendingThreadId.value = threadId
    }

    const turnStart = await client.request<TurnStartResponse>('turn/start', {
      threadId,
      input: [{
        type: 'text',
        text,
        text_elements: []
      }],
      cwd: selectedProject.value?.projectPath ?? null,
      approvalPolicy: 'never'
    })

    currentTurnId = turnStart.turn.id
    liveStream.turnId = turnStart.turn.id

    for (const notification of buffered.splice(0, buffered.length)) {
      if (settleNotification(notification) && completionResolved) {
        break
      }
    }

    await completion
    status.value = 'ready'

    if (routeThreadId.value) {
      await hydrateThread(threadId)
      return
    }
  } catch (caughtError) {
    unsubscribe?.()
    if (session.liveStream?.unsubscribe === unsubscribe) {
      session.liveStream = null
    }
    error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    status.value = 'error'
  }
}

const onPromptEnter = (event: KeyboardEvent) => {
  if (!shouldSubmit(event)) {
    return
  }

  event.preventDefault()
  void sendMessage()
}

onMounted(() => {
  if (!loaded.value) {
    void refreshProjects()
  }

  void scheduleScrollToBottom('auto')
})

watch(() => props.threadId ?? null, (threadId) => {
  if (!threadId) {
    if (isBusy.value || pendingThreadId.value) {
      return
    }

    resetDraftThread()
    return
  }

  if (
    autoRedirectThreadId.value === threadId
    && activeThreadId.value === threadId
    && isBusy.value
  ) {
    autoRedirectThreadId.value = null
    pendingThreadId.value = null
    return
  }

  void hydrateThread(threadId)
}, { immediate: true })

watch(pendingThreadId, async (threadId) => {
  if (!threadId) {
    return
  }

  if (routeThreadId.value === threadId) {
    pendingThreadId.value = null
    autoRedirectThreadId.value = null
    return
  }

  autoRedirectThreadId.value = threadId
  await router.push(toProjectThreadRoute(props.projectId, threadId))
  pendingThreadId.value = null
})

watch(messages, () => {
  void scheduleScrollToBottom(status.value === 'streaming' ? 'auto' : 'smooth')
}, { flush: 'post' })

watch(status, (nextStatus, previousStatus) => {
  if (nextStatus === previousStatus) {
    return
  }

  void scheduleScrollToBottom(nextStatus === 'streaming' ? 'auto' : 'smooth')
}, { flush: 'post' })
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-default">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-default px-4 py-3 md:px-6">
      <div class="min-w-0">
        <div class="text-sm font-semibold text-highlighted">
          Codex Workspace
        </div>
        <div class="truncate text-sm text-muted">
          {{ activeThreadId ? `Thread ${activeThreadId}` : 'Start a new thread for this project.' }}
        </div>
      </div>
      <UBadge
        :color="status === 'error' ? 'error' : status === 'ready' ? 'neutral' : 'primary'"
        variant="soft"
      >
        {{ status }}
      </UBadge>
    </div>

    <div
      ref="scrollViewport"
      class="min-h-0 flex-1 overflow-y-auto"
      @scroll="updatePinnedState"
    >
      <UChatMessages
        :messages="messages"
        :status="status"
        :should-auto-scroll="false"
        :should-scroll-to-bottom="false"
        :auto-scroll="false"
        :spacing-offset="140"
        :user="{
          ui: {
            root: 'scroll-mt-4',
            container: 'gap-3 pb-8',
            content: 'px-4 py-3 rounded-2xl min-h-12'
          }
        }"
        :ui="{
          root: 'min-h-full px-4 py-5 md:px-6',
          message: 'max-w-none',
          content: 'w-full max-w-5xl'
        }"
        compact
      >
        <template #content="{ message }">
          <CdMessageContent :message="message as CodoriChatMessage" />
        </template>
      </UChatMessages>
    </div>

    <div class="sticky bottom-0 shrink-0 border-t border-default bg-default/95 px-4 py-3 backdrop-blur md:px-6">
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        :title="error"
        class="mb-3"
      />

      <UChatPrompt
        v-model="input"
        placeholder="Describe the change you want Codex to make"
        :error="submitError"
        :disabled="isBusy"
        autoresize
        @submit.prevent="sendMessage"
        @keydown.enter="onPromptEnter"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
      >
        <UChatPromptSubmit
          :status="status"
        />
      </UChatPrompt>
    </div>
  </section>
</template>

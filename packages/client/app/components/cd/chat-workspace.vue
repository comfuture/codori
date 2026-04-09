<script setup lang="ts">
import { useRouter } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'
import { useCodoriProjects } from '../../composables/useCodoriProjects.js'
import { useCodoriRpc } from '../../composables/useCodoriRpc.js'
import { useChatSubmitGuard } from '../../composables/useChatSubmitGuard.js'
import {
  itemToMessages,
  threadToMessages,
  upsertStreamingMessage,
  type CodoriChatMessage
} from '../../../shared/codex-chat.js'
import {
  notificationThreadId,
  notificationTurnId,
  type CodexRpcNotification,
  type CodexThreadItem,
  type ThreadReadResponse,
  type ThreadResumeResponse,
  type ThreadStartResponse,
  type TurnStartResponse
} from '../../../shared/codex-rpc.js'
import { toProjectThreadRoute } from '../../../shared/codori.js'

const props = defineProps<{
  projectId: string
  threadId?: string | null
}>()

type UiChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  metadata?: {
    label?: string
  }
  parts: Array<{
    type: 'text'
    text: string
    state?: 'done' | 'streaming'
  }>
}

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

const messages = ref<CodoriChatMessage[]>([])
const input = ref('')
const status = ref<'ready' | 'submitted' | 'streaming' | 'error'>('ready')
const error = ref<string | null>(null)
const activeThreadId = ref<string | null>(props.threadId ?? null)
const loadVersion = ref(0)

const selectedProject = computed(() => getProject(props.projectId))
const submitError = computed(() => error.value ? new Error(error.value) : undefined)

const uiMessages = computed<UiChatMessage[]>(() =>
  messages.value.map(message => ({
    id: message.id,
    role: message.role,
    metadata: message.label ? { label: message.label } : undefined,
    parts: [{
      type: 'text',
      text: message.text,
      state: message.pending ? 'streaming' : 'done'
    }]
  }))
)

const getMessageText = (message: UiChatMessage) =>
  message.parts
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n')

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
    status.value = 'ready'
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    status.value = 'error'
  }
}

const resetDraftThread = () => {
  activeThreadId.value = null
  messages.value = []
  error.value = null
  status.value = 'ready'
}

const ensureThread = async () => {
  if (activeThreadId.value) {
    return activeThreadId.value
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
  await router.push(toProjectThreadRoute(props.projectId, response.thread.id))
  return response.thread.id
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

const appendStreamingText = (messageId: string, delta: string, fallback: Partial<CodoriChatMessage>) => {
  const existing = messages.value.find(message => message.id === messageId)
  messages.value = upsertStreamingMessage(messages.value, {
    id: messageId,
    role: existing?.role ?? fallback.role ?? 'assistant',
    label: existing?.label ?? fallback.label,
    text: `${existing?.text ?? fallback.text ?? ''}${delta}`,
    pending: true
  })
}

const applyNotification = (notification: CodexRpcNotification) => {
  switch (notification.method) {
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
      appendStreamingText(params.itemId, params.delta, {
        role: 'assistant',
        text: ''
      })
      status.value = 'streaming'
      return
    }
    case 'item/commandExecution/outputDelta': {
      const params = notification.params as { itemId: string, delta: string }
      appendStreamingText(params.itemId, params.delta, {
        role: 'system',
        label: 'Command',
        text: ''
      })
      status.value = 'streaming'
      return
    }
    case 'item/fileChange/outputDelta': {
      const params = notification.params as { itemId: string, delta: string }
      appendStreamingText(params.itemId, params.delta, {
        role: 'system',
        label: 'File changes',
        text: ''
      })
      status.value = 'streaming'
      return
    }
    case 'item/mcpToolCall/progress': {
      const params = notification.params as { itemId: string, message: string }
      appendStreamingText(params.itemId, `${params.message}\n`, {
        role: 'system',
        label: 'MCP tool',
        text: ''
      })
      status.value = 'streaming'
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

  error.value = null
  status.value = 'submitted'
  input.value = ''

  const optimisticMessage: CodoriChatMessage = {
    id: `local-user-${Date.now()}`,
    role: 'user',
    text
  }
  messages.value = [...messages.value, optimisticMessage]
  let unsubscribe: (() => void) | null = null

  try {
    await ensureProjectRuntime()
    const threadId = await ensureThread()
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
        const params = notification.params as { error?: { message?: string } }
        rejectCompletion?.(new Error(params.error?.message ?? 'Turn failed.'))
        return true
      }

      if (notification.method !== 'turn/completed') {
        applyNotification(notification)
      }

      if (notification.method === 'turn/completed') {
        completionResolved = true
        unsubscribe?.()
        resolveCompletion?.()
        return true
      }

      return false
    }

    const completion = new Promise<void>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = (caughtError: Error) => reject(caughtError)
    })

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

    for (const notification of buffered.splice(0, buffered.length)) {
      if (settleNotification(notification) && completionResolved) {
        break
      }
    }

    await completion
    await hydrateThread(threadId)
  } catch (caughtError) {
    unsubscribe?.()
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
})

watch(() => props.threadId ?? null, (threadId) => {
  if (!threadId) {
    resetDraftThread()
    return
  }

  void hydrateThread(threadId)
}, { immediate: true })
</script>

<template>
  <UCard
    :ui="{
      body: 'p-0',
      footer: 'p-0'
    }"
    class="overflow-hidden"
  >
    <template #header>
      <div class="flex items-center justify-between gap-3">
        <div>
          <div class="text-lg font-semibold">
            Codex Workspace
          </div>
          <div class="text-sm text-muted">
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
    </template>

    <div class="flex min-h-[32rem] flex-col">
      <UChatMessages
        :messages="uiMessages"
        :status="status"
        :user="{
          ui: {
            root: 'scroll-mt-4',
            container: 'gap-3 pb-8',
            content: 'px-4 py-3 rounded-lg min-h-12'
          }
        }"
        :ui="{ root: 'min-h-0 flex-1 px-4 pt-4' }"
        compact
        should-auto-scroll
      >
        <template #content="{ message }">
          <div class="space-y-2">
            <div
              v-if="message.metadata?.label"
              class="text-[11px] font-medium uppercase tracking-[0.24em] text-muted"
            >
              {{ message.metadata.label }}
            </div>
            <div class="whitespace-pre-wrap text-sm leading-6">
              {{ getMessageText(message as UiChatMessage) }}
            </div>
          </div>
        </template>
      </UChatMessages>

      <div class="border-t border-default p-4">
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
          :disabled="status === 'submitted' || status === 'streaming'"
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
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, watch, type ComponentPublicInstance, type VNodeRef } from 'vue'
import type { VisualSubagentPanel } from '~~/shared/codex-chat'

const props = defineProps<{
  agents: VisualSubagentPanel[]
}>()

const SCROLL_RETRY_DELAY_MS = 48
const SCROLL_RETRY_COUNT = 4
const SUBAGENT_ACCENT_PALETTE = [
  'text-emerald-700 dark:text-emerald-300',
  'text-sky-700 dark:text-sky-300',
  'text-amber-800 dark:text-amber-300',
  'text-rose-700 dark:text-rose-300',
  'text-violet-700 dark:text-violet-300',
  'text-cyan-700 dark:text-cyan-300',
  'text-lime-800 dark:text-lime-300',
  'text-orange-700 dark:text-orange-300'
] as const

const scrollContainers = new Map<string, HTMLElement>()
const scrollRetryTimers = new Map<string, number>()
const scrollContainerRefs = new Map<string, VNodeRef>()

const paneSize = computed(() => {
  if (!props.agents.length) {
    return 100
  }

  return 100 / props.agents.length
})

const agentAccentClass = (index: number) =>
  SUBAGENT_ACCENT_PALETTE[index % SUBAGENT_ACCENT_PALETTE.length]

const statusColor = (status: VisualSubagentPanel['status']) => {
  switch (status) {
    case 'running':
      return 'info'
    case 'pendingInit':
      return 'primary'
    case 'completed':
      return 'success'
    case 'interrupted':
      return 'warning'
    case 'errored':
      return 'error'
    case 'shutdown':
    case 'notFound':
      return 'neutral'
    default:
      return 'neutral'
  }
}

const statusLabel = (status: VisualSubagentPanel['status']) => {
  switch (status) {
    case 'pendingInit':
      return 'pending'
    case 'running':
      return 'running'
    case 'completed':
      return 'completed'
    case 'interrupted':
      return 'interrupted'
    case 'errored':
      return 'errored'
    case 'shutdown':
      return 'shutdown'
    case 'notFound':
      return 'not found'
    default:
      return 'active'
  }
}

const isStreamingStatus = (status: VisualSubagentPanel['status']) =>
  status === 'pendingInit' || status === 'running'

const clearScrollRetry = (threadId: string) => {
  const timer = scrollRetryTimers.get(threadId)
  if (timer !== undefined) {
    window.clearTimeout(timer)
    scrollRetryTimers.delete(threadId)
  }
}

const scrollContainerToBottom = (threadId: string) => {
  const container = scrollContainers.get(threadId)
  if (!container) {
    return
  }
  container.scrollTop = container.scrollHeight
}

const queueScrollToBottom = (threadId: string, attempt = 0) => {
  if (!import.meta.client) {
    return
  }

  if (attempt === 0) {
    clearScrollRetry(threadId)
  }

  void nextTick(() => {
    scrollContainerToBottom(threadId)
    if (attempt >= SCROLL_RETRY_COUNT) {
      return
    }

    const timer = window.setTimeout(() => {
      queueScrollToBottom(threadId, attempt + 1)
    }, SCROLL_RETRY_DELAY_MS)

    scrollRetryTimers.set(threadId, timer)
  })
}

const setScrollContainer = (threadId: string, container: Element | null) => {
  if (!(container instanceof HTMLElement)) {
    scrollContainers.delete(threadId)
    clearScrollRetry(threadId)
    return
  }

  scrollContainers.set(threadId, container)
  queueScrollToBottom(threadId)
}

const scrollContainerRef = (threadId: string) => {
  const existing = scrollContainerRefs.get(threadId)
  if (existing) {
    return existing
  }

  const ref: VNodeRef = (container: Element | ComponentPublicInstance | null) => {
    const resolved = container instanceof Element
      ? container
      : container && '$el' in container && container.$el instanceof Element
        ? container.$el
        : null
    setScrollContainer(threadId, resolved)
  }

  scrollContainerRefs.set(threadId, ref)
  return ref
}

const panelSignatures = computed(() =>
  props.agents.map(agent => ({
    threadId: agent.threadId,
    signature: [
      agent.messages.length,
      agent.messages.at(-1)?.id ?? '',
      agent.status ?? ''
    ].join(':')
  }))
)

watch(panelSignatures, (signatures) => {
  const activeThreadIds = new Set(signatures.map(entry => entry.threadId))

  for (const { threadId } of signatures) {
    queueScrollToBottom(threadId)
  }

  for (const threadId of scrollRetryTimers.keys()) {
    if (!activeThreadIds.has(threadId)) {
      clearScrollRetry(threadId)
    }
  }
}, { immediate: true })

onBeforeUnmount(() => {
  for (const threadId of scrollRetryTimers.keys()) {
    clearScrollRetry(threadId)
  }
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col divide-y divide-default">
    <section
      v-for="(agent, index) in agents"
      :key="agent.threadId"
      class="flex min-h-0 flex-1 flex-col bg-elevated/25"
      :style="{ flexBasis: `${paneSize}%` }"
    >
      <header class="flex items-center justify-between gap-2 border-b border-default px-3 py-2">
        <div class="min-w-0">
          <p
            class="truncate text-sm font-semibold"
            :class="agentAccentClass(index)"
          >
            {{ agent.name }}
          </p>
        </div>
        <UBadge
          :color="statusColor(agent.status)"
          variant="soft"
          size="sm"
        >
          {{ statusLabel(agent.status) }}
        </UBadge>
      </header>

      <div
        :ref="scrollContainerRef(agent.threadId)"
        class="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        <div
          v-if="agent.messages.length === 0"
          class="rounded-lg border border-dashed border-default px-3 py-4 text-sm text-muted"
        >
          Waiting for subagent output...
        </div>

        <UChatMessages
          v-else
          :messages="agent.messages"
          :status="isStreamingStatus(agent.status) ? 'streaming' : 'ready'"
          :user="{
            ui: {
              root: 'scroll-mt-4',
              container: 'gap-3 pb-8',
              content: 'px-4 py-3 rounded-lg min-h-12'
            }
          }"
          :ui="{ root: 'subagent-chat-messages min-h-full min-w-0 [&>article]:min-w-0 [&_[data-slot=content]]:min-w-0' }"
          compact
          should-auto-scroll
        >
          <template #content="{ message }">
            <MessageContent :message="message as VisualSubagentPanel['messages'][number]" />
          </template>
        </UChatMessages>
      </div>
    </section>
  </div>
</template>

<style scoped>
.subagent-chat-messages :deep(.cd-markdown),
.subagent-chat-messages :deep([data-slot='content']) {
  min-width: 0;
  max-width: 100%;
}

.subagent-chat-messages :deep(.cd-markdown p),
.subagent-chat-messages :deep(.cd-markdown li),
.subagent-chat-messages :deep(.cd-markdown a),
.subagent-chat-messages :deep(.cd-markdown code) {
  overflow-wrap: anywhere;
  word-break: break-word;
}

.subagent-chat-messages :deep(.cd-markdown pre),
.subagent-chat-messages :deep(.cd-markdown .shiki),
.subagent-chat-messages :deep(.cd-markdown .shiki code) {
  max-width: 100%;
  white-space: pre-wrap !important;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow-x: hidden !important;
}
</style>

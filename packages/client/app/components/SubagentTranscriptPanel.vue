<script lang="ts">
const sharedScrollPositions = new Map<string, number>()
const sharedStickToBottomStates = new Map<string, boolean>()
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { VisualSubagentPanel } from '~~/shared/codex-chat'
import { resolveSubagentStatusMeta, type SubagentAccent } from '~~/shared/subagent-panels'

const props = withDefaults(defineProps<{
  agent: VisualSubagentPanel
  accent?: SubagentAccent | null
  expanded?: boolean
  showExpandButton?: boolean
  showCollapseButton?: boolean
}>(), {
  accent: null,
  expanded: false,
  showExpandButton: false,
  showCollapseButton: false
})

const emit = defineEmits<{
  expand: []
  collapse: []
}>()

const SCROLL_RETRY_DELAY_MS = 48
const SCROLL_RETRY_COUNT = 4
const SCROLL_STICKY_THRESHOLD_PX = 24

const scrollContainer = ref<HTMLElement | null>(null)
let scrollRetryTimer: number | null = null

const statusMeta = computed(() => resolveSubagentStatusMeta(props.agent.status))
const panelSignature = computed(() => [
  props.agent.messages.length,
  props.agent.messages.at(-1)?.id ?? '',
  props.agent.status ?? ''
].join(':'))

const clearScrollRetry = () => {
  if (scrollRetryTimer !== null) {
    window.clearTimeout(scrollRetryTimer)
    scrollRetryTimer = null
  }
}

const isNearBottom = (container: HTMLElement) =>
  container.scrollHeight - container.scrollTop - container.clientHeight <= SCROLL_STICKY_THRESHOLD_PX

const rememberScrollState = () => {
  if (!scrollContainer.value) {
    return
  }

  sharedScrollPositions.set(props.agent.threadId, scrollContainer.value.scrollTop)
  sharedStickToBottomStates.set(props.agent.threadId, isNearBottom(scrollContainer.value))
}

const restoreScrollState = () => {
  if (!scrollContainer.value) {
    return
  }

  const savedTop = sharedScrollPositions.get(props.agent.threadId)
  if (savedTop !== undefined) {
    scrollContainer.value.scrollTop = savedTop
  }

  sharedStickToBottomStates.set(
    props.agent.threadId,
    savedTop === undefined || isNearBottom(scrollContainer.value)
  )
}

const scrollToBottom = () => {
  if (!scrollContainer.value) {
    return
  }

  scrollContainer.value.scrollTop = scrollContainer.value.scrollHeight
  rememberScrollState()
}

const queueScrollToBottom = (attempt = 0) => {
  if (!import.meta.client) {
    return
  }

  if (attempt === 0) {
    clearScrollRetry()
  }

  void nextTick(() => {
    scrollToBottom()
    if (attempt >= SCROLL_RETRY_COUNT) {
      return
    }

    scrollRetryTimer = window.setTimeout(() => {
      queueScrollToBottom(attempt + 1)
    }, SCROLL_RETRY_DELAY_MS)
  })
}

const onScroll = () => {
  rememberScrollState()
}

watch(scrollContainer, (container) => {
  if (!container) {
    clearScrollRetry()
    return
  }

  restoreScrollState()
  if (!sharedScrollPositions.has(props.agent.threadId)) {
    queueScrollToBottom()
  }
}, { immediate: true })

watch(() => props.agent.threadId, (_, previousThreadId) => {
  if (previousThreadId) {
    rememberScrollState()
  }

  clearScrollRetry()
  void nextTick(() => {
    restoreScrollState()
    if (!sharedScrollPositions.has(props.agent.threadId)) {
      queueScrollToBottom()
    }
  })
})

watch(panelSignature, () => {
  if (sharedStickToBottomStates.get(props.agent.threadId) === false) {
    return
  }

  queueScrollToBottom()
}, { immediate: true })

onBeforeUnmount(() => {
  rememberScrollState()
  clearScrollRetry()
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-elevated/25">
    <header
      class="flex items-center justify-between gap-2 border-b border-default px-3 py-2"
      :class="props.accent?.headerClass"
    >
      <div class="min-w-0">
        <p
          class="truncate text-sm font-semibold"
          :class="props.accent?.textClass || 'text-highlighted'"
        >
          {{ agent.name }}
        </p>
        <p
          v-if="expanded"
          class="text-xs text-muted"
        >
          Focused subagent transcript
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-1.5">
        <UBadge
          :color="statusMeta.color"
          variant="soft"
          size="sm"
        >
          {{ statusMeta.label }}
        </UBadge>
        <UButton
          v-if="showExpandButton"
          icon="i-lucide-expand"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          aria-label="Expand subagent"
          @click="emit('expand')"
        />
        <UButton
          v-if="showCollapseButton"
          icon="i-lucide-shrink"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          aria-label="Collapse subagent"
          @click="emit('collapse')"
        />
      </div>
    </header>

    <div
      ref="scrollContainer"
      class="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      @scroll="onScroll"
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
        :status="agent.status === 'pendingInit' || agent.status === 'running' ? 'streaming' : 'ready'"
        :user="{
          ui: {
            root: 'scroll-mt-4',
            container: 'gap-3 pb-8',
            content: 'px-4 py-3 rounded-lg min-h-12'
          }
        }"
        :ui="{ root: 'subagent-chat-messages min-h-full min-w-0 [&>article]:min-w-0 [&_[data-slot=content]]:min-w-0' }"
        compact
      >
        <template #content="{ message }">
          <MessageContent :message="message as VisualSubagentPanel['messages'][number]" />
        </template>
      </UChatMessages>
    </div>
  </section>
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

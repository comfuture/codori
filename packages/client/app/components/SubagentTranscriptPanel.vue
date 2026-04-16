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
  projectId?: string | null
  accent?: SubagentAccent | null
  expanded?: boolean
  showExpandButton?: boolean
  showCollapseButton?: boolean
  scrollScope?: string
}>(), {
  accent: null,
  expanded: false,
  showExpandButton: false,
  showCollapseButton: false,
  scrollScope: 'default'
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
let isTickPending = false

const statusMeta = computed(() => resolveSubagentStatusMeta(props.agent.status))
const scrollStateKey = computed(() => `${props.scrollScope}:${props.agent.threadId}`)
const lastMessageSignature = computed(() => {
  const lastMessage = props.agent.messages.at(-1)
  if (!lastMessage) {
    return ''
  }

  return JSON.stringify({
    id: lastMessage.id,
    pending: lastMessage.pending ?? false,
    parts: lastMessage.parts.map((part) => {
      if (part.type === 'text') {
        return [part.type, part.state ?? '', part.text.length]
      }

      if (part.type === 'reasoning') {
        return [
          part.type,
          part.state ?? '',
          part.summary.join('\n').length,
          part.content.join('\n').length
        ]
      }

      if (part.type === 'attachment') {
        return [part.type, part.attachment.name, part.attachment.url ?? part.attachment.localPath ?? '']
      }

      return [part.type, JSON.stringify(part.data).length]
    })
  })
})
const panelSignature = computed(() => [
  props.agent.messages.length,
  lastMessageSignature.value,
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

  sharedScrollPositions.set(scrollStateKey.value, scrollContainer.value.scrollTop)
  sharedStickToBottomStates.set(scrollStateKey.value, isNearBottom(scrollContainer.value))
}

const restoreScrollState = () => {
  if (!scrollContainer.value) {
    return
  }

  const savedTop = sharedScrollPositions.get(scrollStateKey.value)
  if (savedTop !== undefined) {
    scrollContainer.value.scrollTop = savedTop
  }

  sharedStickToBottomStates.set(
    scrollStateKey.value,
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
    if (isTickPending) {
      return
    }
    isTickPending = true
  }

  void nextTick(() => {
    if (attempt === 0) {
      isTickPending = false
    }

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
  if (!sharedScrollPositions.has(scrollStateKey.value)) {
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
    if (!sharedScrollPositions.has(scrollStateKey.value)) {
      queueScrollToBottom()
    }
  })
})

watch(panelSignature, () => {
  if (sharedStickToBottomStates.get(scrollStateKey.value) === false) {
    return
  }

  queueScrollToBottom()
})

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
          <MessageContent
            :message="message as VisualSubagentPanel['messages'][number]"
            :project-id="projectId ?? undefined"
          />
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

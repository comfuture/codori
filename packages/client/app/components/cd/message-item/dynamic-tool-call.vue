<script setup lang="ts">
import { computed } from 'vue'
import type { CodoriDynamicToolCallItem } from '~~/shared/codex-chat.js'
import { useChatToolState } from './use-chat-tool-state.js'

const props = defineProps<{
  item: CodoriDynamicToolCallItem
}>()

const inputSummary = computed(() =>
  props.item.contentItems?.map((entry) =>
    entry.type === 'inputText' ? entry.text : `[image] ${entry.imageUrl}`
  ).join('\n\n') ?? ''
)

const normalizeToolName = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.replace(/[_\-\s]/g, '') ?? ''

const normalizedTool = computed(() => normalizeToolName(props.item.tool ?? ''))

const title = computed(() => {
  if (['sharedmemory', 'corazonsharedmemory'].includes(normalizedTool.value)) {
    return 'Memory'
  }

  if (['manageworkflow', 'corazonmanageworkflow'].includes(normalizedTool.value)) {
    return 'Workflow'
  }

  switch (props.item.status) {
    case 'inProgress':
      return 'Running internal tool'
    case 'failed':
      return 'Internal tool failed'
    default:
      return 'Internal tool'
  }
})

const icon = computed(() => {
  if (props.item.status === 'failed') {
    return 'i-lucide-triangle-alert'
  }

  if (['sharedmemory', 'corazonsharedmemory'].includes(normalizedTool.value)) {
    return 'i-lucide-database'
  }

  if (['manageworkflow', 'corazonmanageworkflow'].includes(normalizedTool.value)) {
    return 'i-lucide-workflow'
  }

  return 'i-lucide-wrench'
})

const suffix = computed(() => {
  if (['sharedmemory', 'corazonsharedmemory'].includes(normalizedTool.value)) {
    return 'Internal memory operation'
  }

  if (['manageworkflow', 'corazonmanageworkflow'].includes(normalizedTool.value)) {
    return 'Internal workflow operation'
  }

  return props.item.tool
})
const { open, isLoading, isStreaming } = useChatToolState(() => props.item.status, props.item.status === 'failed')
</script>

<template>
  <UChatTool
    :text="title"
    :suffix="suffix"
    :icon="icon"
    :loading="isLoading"
    :streaming="isStreaming"
    :variant="item.arguments != null || inputSummary ? 'card' : 'inline'"
    :open="open"
    :default-open="item.status === 'failed'"
    @update:open="open = $event"
  >
    <div class="space-y-3">
      <pre
        v-if="inputSummary"
        class="overflow-x-auto rounded-xl border border-default/70 bg-elevated/30 px-3 py-3 text-xs leading-6 text-toned"
      >{{ inputSummary }}</pre>

      <pre
        v-if="item.arguments != null"
        class="overflow-x-auto rounded-xl border border-default/70 bg-elevated/30 px-3 py-3 text-xs leading-6 text-toned"
      >{{ JSON.stringify(item.arguments, null, 2) }}</pre>

      <p
        v-if="item.success !== null"
        class="text-xs font-medium"
        :class="item.success ? 'text-success' : 'text-error'"
      >
        {{ item.success ? 'Completed successfully.' : 'Reported failure.' }}
      </p>
    </div>
  </UChatTool>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CommandExecutionItem } from '~~/shared/codex-chat'
import AnsiOutput from './AnsiOutput.vue'
import { useChatToolState } from './use-chat-tool-state'

const props = defineProps<{
  item: CommandExecutionItem
}>()

const title = computed(() => {
  switch (props.item.status) {
    case 'inProgress':
      return 'Running..'
    case 'failed':
      return 'Run failed'
    default:
      return 'Ran'
  }
})

const output = computed(() => props.item.aggregatedOutput?.trim() ?? '')
const exitSummary = computed(() => {
  if (props.item.exitCode === null) {
    return null
  }

  return props.item.status === 'failed'
    ? `Run failed · exit code ${props.item.exitCode}`
    : `Exit code ${props.item.exitCode}`
})
const { open, isLoading, isStreaming } = useChatToolState(() => props.item.status, props.item.status !== 'completed')
</script>

<template>
  <UChatTool
    :text="title"
    :suffix="item.command"
    icon="i-lucide-terminal"
    :loading="isLoading"
    :streaming="isStreaming"
    variant="card"
    :open="open"
    :default-open="item.status !== 'completed'"
    @update:open="open = $event"
  >
    <div class="space-y-3">
      <AnsiOutput
        v-if="output"
        :text="output"
      />
      <p
        v-else
        class="text-xs text-muted"
      >
        Waiting for output.
      </p>
      <p
        v-if="exitSummary"
        class="text-xs font-medium text-muted"
      >
        {{ exitSummary }}
      </p>
    </div>
  </UChatTool>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CommandExecutionItem } from '~~/shared/codex-chat'
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
const icon = computed(() =>
  props.item.status === 'failed' ? 'i-lucide-triangle-alert' : 'i-lucide-terminal'
)
const { open, isLoading, isStreaming } = useChatToolState(() => props.item.status, props.item.status !== 'completed')
</script>

<template>
  <UChatTool
    :text="title"
    :suffix="item.command"
    :icon="icon"
    :loading="isLoading"
    :streaming="isStreaming"
    variant="card"
    :open="open"
    :default-open="item.status !== 'completed'"
    @update:open="open = $event"
  >
    <div class="space-y-3">
      <pre
        v-if="output"
        class="overflow-x-auto rounded-xl border border-default/70 bg-elevated/40 px-3 py-3 text-xs leading-6 text-toned"
      >{{ output }}</pre>
      <p
        v-else
        class="text-xs text-muted"
      >
        Waiting for output.
      </p>
      <p
        v-if="item.exitCode !== null"
        class="text-xs font-medium text-muted"
      >
        Exit code {{ item.exitCode }}
      </p>
      <UAlert
        v-if="item.status === 'failed' && item.exitCode !== null"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        :title="`Command failed with exit code ${item.exitCode}`"
      />
    </div>
  </UChatTool>
</template>

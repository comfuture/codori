<script setup lang="ts">
import { computed } from 'vue'
import type { McpToolCallItem } from '~~/shared/codex-chat'
import { useChatToolState } from './use-chat-tool-state'

const props = defineProps<{
  item: McpToolCallItem
  progressMessages?: string[]
}>()

const formatPrettyJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

const title = computed(() => 'MCP')

const icon = computed(() =>
  props.item.status === 'failed' ? 'i-lucide-triangle-alert' : 'i-lucide-plug-zap'
)
const { open, isLoading, isStreaming } = useChatToolState(() => props.item.status, props.item.status !== 'completed')
</script>

<template>
  <UChatTool
    :text="title"
    :suffix="`${item.server} ${item.tool}`"
    :icon="icon"
    :loading="isLoading"
    :streaming="isStreaming"
    variant="card"
    :open="open"
    :default-open="item.status !== 'completed'"
    @update:open="open = $event"
  >
    <div class="space-y-3">
      <div
        v-if="item.arguments !== undefined"
        class="rounded-xl border border-default/70 bg-elevated/30 px-3 py-3"
      >
        <p class="mb-2 text-[11px] font-semibold text-muted">
          Arguments
        </p>
        <pre class="overflow-x-auto text-xs leading-6 text-toned">{{ formatPrettyJson(item.arguments) }}</pre>
      </div>

      <div
        v-if="progressMessages?.length"
        class="rounded-xl border border-default/70 bg-elevated/30 px-3 py-3"
      >
        <p class="mb-2 text-[11px] font-semibold text-muted">
          Progress
        </p>
        <ul class="space-y-1">
          <li
            v-for="(message, index) in progressMessages"
            :key="`${item.id}-progress-${index}`"
            class="text-xs leading-6 text-toned"
          >
            {{ message }}
          </li>
        </ul>
      </div>

      <div
        v-if="item.result"
        class="rounded-xl border border-default/70 bg-elevated/30 px-3 py-3"
      >
        <p class="mb-2 text-[11px] font-semibold text-muted">
          Result
        </p>
        <pre class="overflow-x-auto text-xs leading-6 text-toned">{{ formatPrettyJson(item.result) }}</pre>
      </div>

      <UAlert
        v-if="item.error?.message"
        color="error"
        variant="soft"
        icon="i-lucide-triangle-alert"
        :title="item.error.message"
      />
    </div>
  </UChatTool>
</template>

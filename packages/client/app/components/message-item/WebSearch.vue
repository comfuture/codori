<script setup lang="ts">
import { computed } from 'vue'
import type { WebSearchStatus } from '~~/shared/codex-chat'
import type { ThreadItem } from '~~/shared/generated/codex-app-server/v2/ThreadItem'
import { useChatToolState } from './use-chat-tool-state'

const props = defineProps<{
  item: Extract<ThreadItem, { type: 'webSearch' }>
  status: WebSearchStatus
}>()

const title = computed(() => props.status === 'failed' ? 'Web search failed' : 'Web search')
const icon = computed(() => props.status === 'failed' ? 'i-lucide-triangle-alert' : 'i-lucide-search')
const { open, isLoading, isStreaming } = useChatToolState(() => props.status, props.status === 'failed')
</script>

<template>
  <UChatTool
    :text="title"
    :suffix="item.query"
    :icon="icon"
    :loading="isLoading"
    :streaming="isStreaming"
    variant="inline"
    :open="open"
    :default-open="status === 'failed'"
    @update:open="open = $event"
  />
</template>

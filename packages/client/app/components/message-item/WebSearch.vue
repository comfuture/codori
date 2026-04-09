<script setup lang="ts">
import type { CodexThreadItem } from '~~/shared/codex-rpc.js'
import { useChatToolState } from './use-chat-tool-state.js'

const props = defineProps<{
  item: Extract<CodexThreadItem, { type: 'webSearch' }>
}>()

const { open, isLoading, isStreaming } = useChatToolState(() => props.item.status, props.item.status === 'failed')
</script>

<template>
  <UChatTool
    text="Web search"
    :suffix="item.query"
    icon="i-lucide-search"
    :loading="isLoading"
    :streaming="isStreaming"
    variant="inline"
    :open="open"
    :default-open="item.status === 'failed'"
    @update:open="open = $event"
  />
</template>

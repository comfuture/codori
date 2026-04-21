<script setup lang="ts">
import { computed } from 'vue'
import type { ThreadItem } from '~~/shared/generated/codex-app-server/v2/ThreadItem'
import { useChatToolState } from './use-chat-tool-state'

const props = defineProps<{
  item: Extract<ThreadItem, { type: 'webSearch' }>
  pending?: boolean
}>()

const derivedStatus = computed(() => props.pending ? 'inProgress' : 'completed')
const { open, isLoading, isStreaming } = useChatToolState(() => derivedStatus.value)
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
    @update:open="open = $event"
  />
</template>

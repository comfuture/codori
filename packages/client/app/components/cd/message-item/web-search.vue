<script setup lang="ts">
import type { CodexThreadItem } from '~~/shared/codex-rpc.js'
import CdMessageItemChatTool from './chat-tool.vue'

defineProps<{
  item: Extract<CodexThreadItem, { type: 'webSearch' }>
}>()
</script>

<template>
  <CdMessageItemChatTool
    text="Web search"
    :suffix="item.query"
    icon="i-lucide-search"
    variant="inline"
  />
</template>

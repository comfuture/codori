<script setup lang="ts">
import type { ChatMessage } from '~~/shared/codex-chat'

defineProps<{
  delivery?: ChatMessage['delivery']
}>()
</script>

<template>
  <div
    v-if="delivery === 'async'"
    data-testid="async-message-delivery"
    role="note"
    aria-label="Asynchronous message"
    class="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-2 py-1 text-[11px] font-medium text-primary"
  >
    <UIcon
      name="i-lucide-message-square-reply"
      class="size-3.5"
    />
    <span>Async message</span>
  </div>
</template>

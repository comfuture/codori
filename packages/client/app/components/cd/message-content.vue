<script setup lang="ts">
import MessagePartRenderer from './message-part-renderer.js'
import type { CodoriChatMessage, CodoriChatPart } from '~~/shared/codex-chat.js'

defineProps<{
  message?: CodoriChatMessage | null
}>()

const partKey = (messageId: string | undefined, part: CodoriChatPart, index: number) => {
  if ('data' in part && part.data && 'item' in part.data && typeof part.data.item.id === 'string') {
    return part.data.item.id
  }

  return `${messageId ?? 'message'}-${part.type}-${index}`
}
</script>

<template>
  <div class="space-y-3">
    <MessagePartRenderer
      v-for="(part, index) in message?.parts ?? []"
      :key="partKey(message?.id, part, index)"
      :message="message"
      :part="part"
    />
  </div>
</template>

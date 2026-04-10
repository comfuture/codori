<script setup lang="ts">
import MessagePartRenderer from './MessagePartRenderer'
import type { ChatMessage, ChatPart } from '~~/shared/codex-chat'

defineProps<{
  message?: ChatMessage | null
  projectId?: string
}>()

const partKey = (messageId: string | undefined, part: ChatPart, index: number) => {
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
      :project-id="projectId"
      :part="part"
    />
  </div>
</template>

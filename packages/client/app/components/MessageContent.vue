<script setup lang="ts">
import MessagePartRenderer from './MessagePartRenderer'
import MessagePartAsyncDelivery from './message-part/AsyncDelivery.vue'
import type { ChatMessage, ChatPart } from '~~/shared/codex-chat'
import type { WorkspaceAttachmentScope } from '~~/shared/chat-attachments'

defineProps<{
  message?: ChatMessage | null
  projectId?: string
  workspace?: WorkspaceAttachmentScope
  workspaceRootPath?: string | null
  allowAsyncReply?: boolean
}>()

const emit = defineEmits<{
  answer: [message: ChatMessage]
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
    <MessagePartAsyncDelivery
      v-if="!message?.questions?.length"
      :delivery="message?.delivery"
    />

    <p
      v-if="message?.toolOutput"
      class="text-xs font-medium text-muted"
    >
      Tool output · {{ [message.toolOutput.namespace, message.toolOutput.name].filter(Boolean).join('.') }}
    </p>

    <button
      v-if="allowAsyncReply && message?.questions?.length"
      type="button"
      class="inline-flex cursor-pointer items-center rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:bg-primary/10"
      :aria-label="`Answer: ${message.questions.map(question => question.title).join(' ')}`"
      @click="emit('answer', message)"
    >
      [User Answer]
    </button>

    <template v-else>
      <MessagePartRenderer
        v-for="(part, index) in message?.parts ?? []"
        :key="partKey(message?.id, part, index)"
        :message="message"
        :project-id="projectId"
        :workspace="workspace"
        :workspace-root-path="workspaceRootPath"
        :part="part"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from '#imports'
import { computed } from 'vue'
import ChatSessionShell from '../../components/ChatSessionShell.vue'

const route = useRoute()
const chatId = computed(() => {
  const value = route.params.chatId
  return typeof value === 'string' ? value : null
})
</script>

<template>
  <ChatSessionShell :chat-id="chatId" />
</template>

<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted } from 'vue'
import { useChats } from '../../composables/useChats'

const route = useRoute()
const router = useRouter()
const {
  chats,
  loaded,
  refreshChats,
  fetchChat,
  getChat
} = useChats()

const chatId = computed(() => {
  const value = route.params.chatId
  return typeof value === 'string' ? value : null
})
const selectedChat = computed(() => getChat(chatId.value))
const chatTitle = computed(() => selectedChat.value?.title?.trim() || 'New Chat')

onMounted(async () => {
  if (!loaded.value) {
    await refreshChats()
  }

  if (chatId.value && !getChat(chatId.value)) {
    try {
      await fetchChat(chatId.value)
    } catch {
      if (chats.value.length > 0) {
        await router.push('/')
      }
    }
  }
})
</script>

<template>
  <div class="app-shell-height flex h-screen h-dvh min-h-0 flex-1 min-w-0">
    <UDashboardPanel
      id="chat-shell"
      class="min-h-0 min-w-0 flex-1"
      :ui="{ root: '!p-0', body: '!p-0 sm:!p-0 !gap-0 sm:!gap-0' }"
    >
      <template #header>
        <UDashboardNavbar
          :title="chatTitle"
          icon="i-lucide-message-square"
        />
      </template>

      <template #body>
        <ChatWorkspace
          v-if="chatId"
          workspace-kind="chat"
          :chat-id="chatId"
          :thread-id="selectedChat?.threadId ?? null"
          class="min-h-0 flex-1"
        />
      </template>
    </UDashboardPanel>
  </div>
</template>

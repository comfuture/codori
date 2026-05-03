<script setup lang="ts">
import type { CommandPaletteGroup } from '@nuxt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChats } from '../composables/useChats'
import { useCodoriRouter } from '../composables/useCodoriRouter'
import { useProjects } from '../composables/useProjects'
import {
  isEditableShortcutTarget,
  isGlobalCommandPaletteShortcut,
  isMacLikePlatform
} from '../utils/global-command-palette-shortcut'
import { sortSidebarProjects } from '../utils/project-sidebar-order'
import { toChatRoute, toChatsRoute, toProjectRoute } from '~~/shared/codori'

const open = ref(false)
const searchTerm = ref('')
const platform = ref('')
const router = useCodoriRouter()
const {
  chats,
  loaded: chatsLoaded,
  loading: chatsLoading,
  refreshChats
} = useChats()
const {
  projects,
  loaded: projectsLoaded,
  loading: projectsLoading,
  refreshProjects
} = useProjects()

const isMac = computed(() => isMacLikePlatform(platform.value))
const commandKbds = computed(() => [isMac.value ? 'meta' : 'ctrl', 'K'])

const ensurePaletteData = () => {
  if (!chatsLoaded.value) {
    void refreshChats()
  }
  if (!projectsLoaded.value) {
    void refreshProjects()
  }
}

const openPalette = () => {
  open.value = true
  ensurePaletteData()
}

const closePalette = () => {
  open.value = false
}

const selectNewChat = async () => {
  closePalette()
  await router.push(toChatsRoute())
}

const selectChat = async (chatId: string) => {
  closePalette()
  await router.push(toChatRoute(chatId))
}

const selectProject = async (projectId: string) => {
  closePalette()
  await router.push(toProjectRoute(projectId))
}

const formatChatTitle = (chat: { chatId: string, title: string | null }) =>
  chat.title?.trim() || chat.chatId || 'New Chat'

const formatChatDate = (chat: { createdAt: number | null }) => {
  if (!chat.createdAt) {
    return 'Date unavailable'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(chat.createdAt))
}

const chatItems = computed(() => {
  if (chatsLoading.value && !chatsLoaded.value) {
    return [{
      label: 'Loading recent chats...',
      icon: 'i-lucide-loader-circle',
      disabled: true
    }]
  }

  return chats.value.map(chat => ({
    label: formatChatTitle(chat),
    suffix: formatChatDate(chat),
    icon: 'i-lucide-message-square',
    onSelect: () => selectChat(chat.chatId)
  }))
})

const projectItems = computed(() => {
  if (projectsLoading.value && !projectsLoaded.value) {
    return [{
      label: 'Loading projects...',
      icon: 'i-lucide-loader-circle',
      disabled: true
    }]
  }

  if (!projects.value.length && projectsLoaded.value) {
    return [{
      label: 'No projects found',
      icon: 'i-lucide-folder-x',
      disabled: true
    }]
  }

  return sortSidebarProjects(projects.value, null).map(project => ({
    label: project.projectId,
    suffix: project.projectPath,
    icon: 'i-lucide-folder-git-2',
    onSelect: () => selectProject(project.projectId)
  }))
})

const groups = computed<CommandPaletteGroup[]>(() => [
  {
    id: 'actions',
    label: 'Actions',
    items: [{
      label: 'New Chat',
      icon: 'i-lucide-message-square-plus',
      kbds: commandKbds.value,
      onSelect: selectNewChat
    }]
  },
  {
    id: 'chats',
    label: 'Recent Chats',
    items: chatItems.value
  },
  {
    id: 'projects',
    label: 'Recent Projects',
    items: projectItems.value
  }
])

const onKeydown = (event: KeyboardEvent) => {
  if (
    isEditableShortcutTarget(event.target)
    || !isGlobalCommandPaletteShortcut(event, platform.value)
  ) {
    return
  }

  event.preventDefault()
  openPalette()
}

watch(open, (nextOpen) => {
  if (!nextOpen) {
    searchTerm.value = ''
  }
})

onMounted(() => {
  if (typeof window === 'undefined') {
    return
  }

  platform.value = navigator.platform
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  if (typeof window === 'undefined') {
    return
  }

  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <UModal
    v-model:open="open"
    :ui="{ content: 'p-0 sm:max-w-2xl' }"
  >
    <template #content>
      <UCommandPalette
        v-model:search-term="searchTerm"
        :groups="groups"
        :loading="projectsLoading || chatsLoading"
        placeholder="Search Codori"
        close
        class="max-h-[min(72vh,42rem)]"
        :ui="{
          root: 'min-h-0',
          content: 'max-h-[min(60vh,34rem)] overflow-y-auto p-2',
          item: 'rounded-lg',
          input: 'border-0 bg-transparent'
        }"
        @update:open="open = $event"
      />
    </template>
  </UModal>
</template>

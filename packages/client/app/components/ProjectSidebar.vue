<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { useRoute, useRouter } from '#imports'
import { computed, onMounted, ref } from 'vue'
import { useChats } from '../composables/useChats'
import { useProjects } from '../composables/useProjects'
import { sortSidebarProjects } from '../utils/project-sidebar-order'
import { toChatRoute, toProjectRoute } from '~~/shared/codori'

const props = defineProps<{
  collapsed?: boolean
}>()
type ProjectNavigationItem = NavigationMenuItem & {
  projectId: string
  projectPath: string
  status: 'running' | 'stopped' | 'error'
  error: string | null
}

type ChatNavigationItem = NavigationMenuItem & {
  chatId: string
  title: string | null
  createdAt: number
  updatedAt: number | null
}

const route = useRoute()
const router = useRouter()
const addProjectOpen = ref(false)
const {
  projects,
  loaded,
  loading,
  refreshProjects,
} = useProjects()
const {
  chats,
  loaded: chatsLoaded,
  loading: chatsLoading,
  createPending: chatCreatePending,
  deletePendingId: chatDeletePendingId,
  refreshChats,
  createChat,
  deleteChat
} = useChats()

const activeProjectId = computed(() => {
  const param = route.params.projectId
  if (Array.isArray(param)) {
    return param.join('/')
  }
  return typeof param === 'string' ? param : null
})
const activeChatId = computed(() => {
  const param = route.params.chatId
  return typeof param === 'string' ? param : null
})

onMounted(() => {
  if (!loaded.value) {
    void refreshProjects()
  }
  if (!chatsLoaded.value) {
    void refreshChats()
  }
})

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

const startChat = async () => {
  const chat = await createChat()
  await router.push(toChatRoute(chat.chatId))
}

const removeChat = async (chatId: string) => {
  await deleteChat(chatId)
  if (activeChatId.value === chatId) {
    await router.push('/')
  }
}

const chatItems = computed<ChatNavigationItem[][]>(() => [
  chats.value.map(chat => ({
    label: formatChatTitle(chat),
    icon: 'i-lucide-message-square',
    to: toChatRoute(chat.chatId),
    active: activeChatId.value === chat.chatId,
    tooltip: {
      text: chat.chatId
    },
    chatId: chat.chatId,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt
  }))
])

const projectItems = computed<ProjectNavigationItem[][]>(() => [
  sortSidebarProjects(projects.value, activeProjectId.value).map(project => ({
    label: project.projectId,
    icon: 'i-lucide-folder-git-2',
    to: toProjectRoute(project.projectId),
    active: activeProjectId.value === project.projectId,
    tooltip: {
      text: project.projectId
    },
    projectId: project.projectId,
    projectPath: project.projectPath,
    status: project.status,
    error: project.error
  }))
])

const asProjectItem = (item: NavigationMenuItem) => item as ProjectNavigationItem
const asChatItem = (item: NavigationMenuItem) => item as ChatNavigationItem

const isActiveProject = (item: ProjectNavigationItem) => activeProjectId.value === item.projectId
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="space-y-2">
      <UTooltip text="New Chat">
        <UButton
          icon="i-lucide-message-square-plus"
          color="primary"
          variant="soft"
          size="sm"
          :block="!props.collapsed"
          :square="props.collapsed"
          :label="props.collapsed ? undefined : 'New Chat'"
          :loading="chatCreatePending"
          aria-label="New Chat"
          @click="startChat"
        />
      </UTooltip>

      <UNavigationMenu
        v-if="chats.length"
        :items="chatItems"
        orientation="vertical"
        :collapsed="props.collapsed"
        highlight
        color="primary"
        variant="link"
        :popover="false"
        :tooltip="props.collapsed"
        class="w-full"
        :ui="{
          root: 'w-full',
          list: 'gap-1',
          item: 'w-full',
          link: props.collapsed
            ? 'w-full justify-center rounded-lg px-2 py-2'
            : 'w-full rounded-lg px-3 py-2 text-sm',
          linkLeadingIcon: props.collapsed ? 'size-4' : 'size-4 text-dimmed',
          linkLabel: 'min-w-0 flex-1',
          linkTrailing: 'ms-3 shrink-0'
        }"
      >
        <template #item-label="{ item }">
          <div
            v-if="!props.collapsed"
            class="min-w-0"
          >
            <div class="truncate font-medium text-highlighted">
              {{ asChatItem(item).title || asChatItem(item).label }}
            </div>
            <div class="truncate text-[11px] text-muted">
              {{ formatChatDate(asChatItem(item)) }}
            </div>
          </div>
        </template>

        <template #item-trailing="{ item }">
          <div
            v-if="!props.collapsed"
            class="flex items-center"
          >
            <UTooltip text="Delete chat">
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                :loading="chatDeletePendingId === asChatItem(item).chatId"
                aria-label="Delete chat"
                @click.prevent.stop="removeChat(asChatItem(item).chatId)"
              />
            </UTooltip>
          </div>
        </template>
      </UNavigationMenu>

      <div
        v-else-if="chatsLoading && !props.collapsed"
        class="px-3 py-1 text-xs text-muted"
      >
        Loading recent chats...
      </div>
    </div>

    <div class="flex items-center justify-between gap-2">
      <div
        v-if="!props.collapsed"
        class="text-xs font-medium uppercase tracking-[0.24em] text-muted"
      >
        Projects
      </div>
      <div class="flex items-center gap-1">
        <UTooltip text="Add project">
          <UButton
            icon="i-lucide-plus"
            color="neutral"
            variant="ghost"
            size="xs"
            :square="props.collapsed"
            aria-label="Add project"
            @click="addProjectOpen = true"
          />
        </UTooltip>
        <UTooltip text="Refresh projects">
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="xs"
            :loading="loading"
            :square="props.collapsed"
            aria-label="Refresh projects"
            @click="refreshProjects"
          />
        </UTooltip>
      </div>
    </div>

    <div
      v-if="!projects.length && !loading"
      class="rounded-lg border border-dashed border-muted px-3 py-4 text-sm text-muted"
    >
      <span v-if="props.collapsed">0</span>
      <span v-else>No Git projects were discovered under the configured root.</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <UNavigationMenu
        :items="projectItems"
        orientation="vertical"
        :collapsed="props.collapsed"
        highlight
        color="primary"
        variant="link"
        :popover="false"
        :tooltip="props.collapsed"
        class="w-full"
        :ui="{
          root: 'w-full',
          list: 'gap-1',
          item: 'w-full',
          link: props.collapsed
            ? 'w-full justify-center rounded-lg px-2 py-2'
            : 'w-full rounded-lg px-3 py-2.5 text-sm',
          linkLeadingIcon: props.collapsed ? 'size-4' : 'size-4 text-dimmed',
          linkLabel: 'min-w-0 flex-1',
          linkTrailing: 'ms-3 shrink-0'
        }"
      >
        <template #item-label="{ item }">
          <div
            v-if="!props.collapsed"
            class="min-w-0"
          >
            <div class="truncate font-medium text-highlighted">
              {{ asProjectItem(item).projectId }}
            </div>
            <div class="truncate text-[11px] text-muted">
              {{ asProjectItem(item).projectPath }}
            </div>
            <div
              v-if="asProjectItem(item).error"
              class="truncate text-[11px] text-error"
            >
              {{ asProjectItem(item).error }}
            </div>
          </div>
        </template>

        <template #item-trailing="{ item }">
          <div
            v-if="!props.collapsed"
            class="flex items-center"
          >
            <ProjectStatusDot
              :status="asProjectItem(item).status"
              :pulse="isActiveProject(asProjectItem(item))"
            />
          </div>
        </template>
      </UNavigationMenu>
    </div>

    <AddProjectModal v-model:open="addProjectOpen" />
  </div>
</template>

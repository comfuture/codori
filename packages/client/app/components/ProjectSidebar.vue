<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { computed, onMounted, ref, watch } from 'vue'
import { useChats } from '../composables/useChats'
import { useCodoriRoute } from '../composables/useCodoriRoute'
import { useCodoriRouter } from '../composables/useCodoriRouter'
import { useProjects } from '../composables/useProjects'
import { useRpc } from '../composables/useRpc'
import { useThreadPanel } from '../composables/useThreadPanel'
import {
  resolveProjectThreadSummaryKey,
  resolveThreadSummaryTitle,
  useThreadSummaries,
  type ThreadSummary
} from '../composables/useThreadSummaries'
import { isMacLikePlatform } from '../utils/global-command-palette-shortcut'
import { sortSidebarProjects } from '../utils/project-sidebar-order'
import type { ThreadListParams } from '~~/shared/generated/codex-app-server/v2/ThreadListParams'
import type { ThreadListResponse } from '~~/shared/generated/codex-app-server/v2/ThreadListResponse'
import { toChatRoute, toChatsRoute, toProjectRoute, toProjectThreadRoute } from '~~/shared/codori'

const INLINE_THREAD_ROW_LIMIT = 5
const INLINE_THREAD_ROWS_WITH_MORE = INLINE_THREAD_ROW_LIMIT - 1

const props = defineProps<{
  collapsed?: boolean
}>()
const emit = defineEmits<{
  openCommandPalette: []
}>()
type ProjectNavigationItem = NavigationMenuItem & {
  itemKind: 'project'
  projectId: string
  projectPath: string
  error: string | null
}

type ProjectThreadNavigationItem = NavigationMenuItem & {
  itemKind: 'thread'
  projectId: string
  threadId: string
  title: string
  updatedAt: number
}

type ProjectThreadMoreNavigationItem = NavigationMenuItem & {
  itemKind: 'more'
  projectId: string
}

type ProjectThreadStatusNavigationItem = NavigationMenuItem & {
  itemKind: 'thread-status'
  projectId: string
  message: string
}

type ProjectSidebarNavigationItem =
  | ProjectNavigationItem
  | ProjectThreadNavigationItem
  | ProjectThreadMoreNavigationItem
  | ProjectThreadStatusNavigationItem

type ChatNavigationItem = NavigationMenuItem & {
  chatId: string
  title: string | null
  createdAt: number
  updatedAt: number | null
}

const route = useCodoriRoute()
const router = useCodoriRouter()
const addProjectOpen = ref(false)
const platform = ref(typeof navigator === 'undefined' ? '' : navigator.platform)
const isMac = computed(() => isMacLikePlatform(platform.value))
const inlineThreadsProjectId = ref<string | null>(null)
const inlineThreadsLoading = ref(false)
const inlineThreadsError = ref<string | null>(null)
const inlineThreadsHasMore = ref(false)
let inlineThreadFetchSequence = 0
const {
  projects,
  loaded,
  loading,
  refreshProjects,
  startProject,
  getProject
} = useProjects()
const { getClient } = useRpc()
const { openPanel } = useThreadPanel()
const {
  chats,
  loaded: chatsLoaded,
  loading: chatsLoading,
  createPending: chatCreatePending,
  deletePendingId: chatDeletePendingId,
  refreshChats,
  deleteChat
} = useChats()

const inlineThreadSummariesForProject = (projectId: string | null) =>
  useThreadSummaries(resolveProjectThreadSummaryKey(projectId))

const inlineThreads = computed<ThreadSummary[]>(() => {
  if (!inlineThreadsProjectId.value) {
    return []
  }

  return inlineThreadSummariesForProject(inlineThreadsProjectId.value).threads.value
})

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
const activeThreadId = computed(() => {
  const param = route.params.threadId
  return typeof param === 'string' ? param : null
})

onMounted(() => {
  if (typeof navigator !== 'undefined') {
    platform.value = navigator.platform
  }
  if (!loaded.value) {
    void refreshProjects()
  }
  if (!chatsLoaded.value) {
    void refreshChats()
  }
  void fetchInlineThreads()
})

const resetInlineThreads = () => {
  inlineThreadsProjectId.value = null
  inlineThreadsLoading.value = false
  inlineThreadsError.value = null
  inlineThreadsHasMore.value = false
}

const waitForProjectsRefresh = async () => {
  if (loaded.value || !loading.value) {
    return
  }

  await new Promise<void>((resolve) => {
    const stop = watch([loaded, loading], ([projectsLoaded, projectsLoading]) => {
      if (projectsLoaded || !projectsLoading) {
        stop()
        resolve()
      }
    })
  })
}

const fetchInlineThreads = async () => {
  const projectId = activeProjectId.value
  if (!projectId || props.collapsed) {
    resetInlineThreads()
    return
  }

  const sequence = ++inlineThreadFetchSequence
  inlineThreadsProjectId.value = projectId
  inlineThreadsLoading.value = true
  inlineThreadsError.value = null
  inlineThreadsHasMore.value = false

  try {
    if (!loaded.value) {
      if (!loading.value) {
        await refreshProjects()
      }
      await waitForProjectsRefresh()
    }

    if (sequence !== inlineThreadFetchSequence) {
      return
    }

    const project = getProject(projectId)
    if (!project) {
      throw new Error(`Project "${projectId}" was not found.`)
    }

    if (project.status !== 'running') {
      await startProject(projectId)
    }

    if (sequence !== inlineThreadFetchSequence) {
      return
    }

    const refreshedProject = getProject(projectId) ?? project
    const client = getClient(projectId)
    const response = await client.request<ThreadListResponse>('thread/list', {
      limit: INLINE_THREAD_ROW_LIMIT,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      cwd: refreshedProject.projectPath
    } satisfies ThreadListParams)

    if (sequence !== inlineThreadFetchSequence) {
      return
    }

    inlineThreadSummariesForProject(projectId).setThreads(response.data.map(thread => ({
      id: thread.id,
      title: resolveThreadSummaryTitle(thread),
      updatedAt: thread.updatedAt
    })))
    inlineThreadsHasMore.value = response.nextCursor !== null
  } catch (caughtError) {
    if (sequence !== inlineThreadFetchSequence) {
      return
    }
    inlineThreadsError.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
  } finally {
    if (sequence === inlineThreadFetchSequence) {
      inlineThreadsLoading.value = false
    }
  }
}

watch([
  activeProjectId,
  () => props.collapsed
], () => {
  void fetchInlineThreads()
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
  await router.push(toChatsRoute())
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

const inlineThreadsHasOverflow = computed(() =>
  inlineThreadsHasMore.value || inlineThreads.value.length > INLINE_THREAD_ROW_LIMIT
)

const visibleInlineThreads = computed(() =>
  inlineThreadsHasOverflow.value
    ? inlineThreads.value.slice(0, INLINE_THREAD_ROWS_WITH_MORE)
    : inlineThreads.value.slice(0, INLINE_THREAD_ROW_LIMIT)
)

const projectItems = computed<ProjectSidebarNavigationItem[][]>(() => [
  sortSidebarProjects(projects.value, activeProjectId.value).flatMap((project) => {
    const items: ProjectSidebarNavigationItem[] = [{
      itemKind: 'project',
      label: project.projectId,
      icon: 'i-lucide-folder-git-2',
      to: toProjectRoute(project.projectId),
      active: activeProjectId.value === project.projectId && !activeThreadId.value,
      tooltip: {
        text: project.projectId
      },
      projectId: project.projectId,
      projectPath: project.projectPath,
      error: project.error
    }]

    if (props.collapsed || activeProjectId.value !== project.projectId) {
      return items
    }

    if (inlineThreadsProjectId.value !== project.projectId) {
      return items
    }

    if (inlineThreadsLoading.value) {
      items.push({
        itemKind: 'thread-status',
        label: 'Loading threads...',
        icon: 'i-lucide-loader-circle',
        disabled: true,
        projectId: project.projectId,
        message: 'Loading threads...'
      })
      return items
    }

    if (inlineThreadsError.value) {
      items.push({
        itemKind: 'thread-status',
        label: 'Threads unavailable',
        icon: 'i-lucide-circle-alert',
        disabled: true,
        projectId: project.projectId,
        message: inlineThreadsError.value
      })
      return items
    }

    for (const thread of visibleInlineThreads.value) {
      items.push({
        itemKind: 'thread',
        label: thread.title,
        icon: 'i-lucide-message-square-text',
        to: toProjectThreadRoute(project.projectId, thread.id),
        active: activeThreadId.value === thread.id,
        tooltip: {
          text: thread.title
        },
        projectId: project.projectId,
        threadId: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt
      })
    }

    if (inlineThreadsHasOverflow.value) {
      items.push({
        itemKind: 'more',
        label: 'more..',
        icon: 'i-lucide-ellipsis',
        projectId: project.projectId,
        tooltip: {
          text: 'Open all threads'
        },
        onSelect: () => {
          openPanel()
        }
      })
    }

    return items
  })
])

const asProjectItem = (item: NavigationMenuItem) => item as ProjectNavigationItem
const asProjectSidebarItem = (item: NavigationMenuItem) => item as ProjectSidebarNavigationItem
const asProjectThreadItem = (item: NavigationMenuItem) => item as ProjectThreadNavigationItem
const asProjectThreadMoreItem = (item: NavigationMenuItem) => item as ProjectThreadMoreNavigationItem
const asProjectThreadStatusItem = (item: NavigationMenuItem) => item as ProjectThreadStatusNavigationItem
const asChatItem = (item: NavigationMenuItem) => item as ChatNavigationItem

const isProjectItem = (item: NavigationMenuItem): item is ProjectNavigationItem =>
  asProjectSidebarItem(item).itemKind === 'project'
const isThreadItem = (item: NavigationMenuItem): item is ProjectThreadNavigationItem =>
  asProjectSidebarItem(item).itemKind === 'thread'
const isMoreItem = (item: NavigationMenuItem): item is ProjectThreadMoreNavigationItem =>
  asProjectSidebarItem(item).itemKind === 'more'
const isThreadStatusItem = (item: NavigationMenuItem): item is ProjectThreadStatusNavigationItem =>
  asProjectSidebarItem(item).itemKind === 'thread-status'
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
        class="text-xs font-medium text-muted"
      >
        Projects
      </div>
      <div class="flex items-center gap-1">
        <UTooltip text="Search Codori">
          <UButton
            v-if="props.collapsed"
            icon="i-lucide-search"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            aria-label="Search Codori"
            @click="emit('openCommandPalette')"
          />
          <UButton
            v-else
            icon="i-lucide-search"
            color="neutral"
            variant="outline"
            size="xs"
            class="min-w-32 justify-start"
            aria-label="Search Codori"
            @click="emit('openCommandPalette')"
          >
            <span class="min-w-0 flex-1 truncate text-left">
              Search
            </span>
            <template #trailing>
              <span class="flex items-center gap-1">
                <UKbd
                  :value="isMac ? 'meta' : 'ctrl'"
                  size="sm"
                />
                <UKbd
                  value="K"
                  size="sm"
                />
              </span>
            </template>
          </UButton>
        </UTooltip>
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
            v-if="!props.collapsed && isProjectItem(item)"
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
          <div
            v-else-if="!props.collapsed && isThreadItem(item)"
            class="min-w-0 ps-2"
          >
            <div class="truncate text-xs font-medium text-highlighted">
              {{ asProjectThreadItem(item).title }}
            </div>
          </div>
          <div
            v-else-if="!props.collapsed && isMoreItem(item)"
            class="min-w-0 ps-2"
          >
            <div class="truncate text-xs font-medium text-muted">
              {{ asProjectThreadMoreItem(item).label }}
            </div>
          </div>
          <div
            v-else-if="!props.collapsed && isThreadStatusItem(item)"
            class="min-w-0 ps-2"
          >
            <div
              class="truncate text-xs"
              :class="asProjectThreadStatusItem(item).message === 'Loading threads...' ? 'text-muted' : 'text-error'"
            >
              {{ asProjectThreadStatusItem(item).message }}
            </div>
          </div>
        </template>
      </UNavigationMenu>
    </div>

    <AddProjectModal v-model:open="addProjectOpen" />
  </div>
</template>

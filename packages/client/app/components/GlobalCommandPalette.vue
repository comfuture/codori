<script setup lang="ts">
import type { CommandPaletteGroup } from '@nuxt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChats } from '../composables/useChats'
import { useCodoriRouter } from '../composables/useCodoriRouter'
import { useProjects } from '../composables/useProjects'
import { useRpc } from '../composables/useRpc'
import { resolveThreadSummaryTitle } from '../composables/useThreadSummaries'
import {
  isEditableShortcutTarget,
  isGlobalCommandPaletteShortcut,
  isMacLikePlatform
} from '../utils/global-command-palette-shortcut'
import { sortSidebarProjects } from '../utils/project-sidebar-order'
import { toChatRoute, toChatsRoute, toProjectRoute, toProjectThreadRoute } from '~~/shared/codori'
import type { ThreadListParams } from '~~/shared/generated/codex-app-server/v2/ThreadListParams'
import type { ThreadListResponse } from '~~/shared/generated/codex-app-server/v2/ThreadListResponse'

type ThreadSearchResult = {
  threadId: string
  title: string
  updatedAt: number
  projectId: string
  projectPath: string
}

const THREAD_SEARCH_MIN_LENGTH = 2
const THREAD_SEARCH_DEBOUNCE_MS = 250
const THREAD_SEARCH_CONCURRENCY = 4
const THREAD_SEARCH_LIMIT_PER_PROJECT = 3
const THREAD_SEARCH_TOTAL_LIMIT = 10

const open = ref(false)
const searchTerm = ref('')
const platform = ref('')
const threadSearchResults = ref<ThreadSearchResult[]>([])
const threadSearchLoading = ref(false)
const threadSearchError = ref<string | null>(null)
const router = useCodoriRouter()
const { getClient } = useRpc()
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
  refreshProjects,
  startProject
} = useProjects()

const isMac = computed(() => isMacLikePlatform(platform.value))
const commandKbds = computed(() => [isMac.value ? 'meta' : 'ctrl', 'K'])
let threadSearchTimer: ReturnType<typeof setTimeout> | null = null
let threadSearchSequence = 0

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

const selectThread = async (thread: ThreadSearchResult) => {
  closePalette()
  await router.push(toProjectThreadRoute(thread.projectId, thread.threadId))
}

const formatChatTitle = (chat: { chatId: string, title: string | null }) =>
  chat.title?.trim() || chat.chatId || 'New Chat'

const formatTimestamp = (timestamp: number | null) => {
  if (!timestamp) {
    return 'Date unavailable'
  }

  const milliseconds = timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(milliseconds))
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
    suffix: formatTimestamp(chat.createdAt),
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

const threadItems = computed(() =>
  threadSearchResults.value.map(thread => ({
    label: thread.title,
    suffix: `${thread.projectId} • ${formatTimestamp(thread.updatedAt)}`,
    icon: 'i-lucide-message-square-text',
    onSelect: () => selectThread(thread)
  }))
)

const threadSearchGroup = computed<CommandPaletteGroup | null>(() => {
  const normalizedSearch = searchTerm.value.trim()
  if (normalizedSearch.length < THREAD_SEARCH_MIN_LENGTH) {
    return null
  }

  if (threadSearchLoading.value && !threadSearchResults.value.length) {
    return {
      id: 'threads',
      label: 'Matching Threads',
      ignoreFilter: true,
      items: [{
        label: 'Searching threads...',
        icon: 'i-lucide-loader-circle',
        disabled: true
      }]
    }
  }

  if (threadSearchError.value && !threadSearchResults.value.length) {
    return {
      id: 'threads',
      label: 'Matching Threads',
      ignoreFilter: true,
      items: [{
        label: threadSearchError.value,
        icon: 'i-lucide-circle-alert',
        disabled: true
      }]
    }
  }

  if (!threadItems.value.length) {
    return null
  }

  return {
    id: 'threads',
    label: 'Matching Threads',
    ignoreFilter: true,
    items: threadItems.value
  }
})

const groups = computed<CommandPaletteGroup[]>(() => [
  ...(threadSearchGroup.value ? [threadSearchGroup.value] : []),
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

const clearThreadSearchTimer = () => {
  if (threadSearchTimer) {
    clearTimeout(threadSearchTimer)
    threadSearchTimer = null
  }
}

const runLimited = async <T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
) => {
  const results: R[] = []
  let nextIndex = 0

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      const item = items[currentIndex]
      if (item) {
        results[currentIndex] = await worker(item)
      }
    }
  })

  await Promise.all(workers)
  return results
}

const searchProjectThreads = async (
  project: { projectId: string, projectPath: string },
  query: string
) => {
  try {
    await startProject(project.projectId)
    const client = getClient(project.projectId)
    const response = await client.request<ThreadListResponse>('thread/list', {
      limit: THREAD_SEARCH_LIMIT_PER_PROJECT,
      sortKey: 'updated_at',
      cwd: project.projectPath,
      searchTerm: query
    } satisfies ThreadListParams)

    return response.data.map(thread => ({
      threadId: thread.id,
      title: resolveThreadSummaryTitle(thread),
      updatedAt: thread.updatedAt,
      projectId: project.projectId,
      projectPath: project.projectPath
    }))
  } catch {
    return []
  }
}

const searchThreads = async (query: string) => {
  const sequence = ++threadSearchSequence
  threadSearchLoading.value = true
  threadSearchError.value = null

  try {
    if (!projectsLoaded.value) {
      await refreshProjects()
    }

    const results = await runLimited(
      projects.value,
      THREAD_SEARCH_CONCURRENCY,
      project => searchProjectThreads(project, query)
    )

    if (sequence !== threadSearchSequence) {
      return
    }

    threadSearchResults.value = results
      .flat()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, THREAD_SEARCH_TOTAL_LIMIT)
  } catch (caughtError) {
    if (sequence !== threadSearchSequence) {
      return
    }

    threadSearchResults.value = []
    threadSearchError.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
  } finally {
    if (sequence === threadSearchSequence) {
      threadSearchLoading.value = false
    }
  }
}

const scheduleThreadSearch = () => {
  clearThreadSearchTimer()

  const query = searchTerm.value.trim()
  if (!open.value || query.length < THREAD_SEARCH_MIN_LENGTH) {
    threadSearchSequence += 1
    threadSearchResults.value = []
    threadSearchError.value = null
    threadSearchLoading.value = false
    return
  }

  threadSearchTimer = setTimeout(() => {
    void searchThreads(query)
  }, THREAD_SEARCH_DEBOUNCE_MS)
}

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
    scheduleThreadSearch()
    return
  }

  scheduleThreadSearch()
})

watch(searchTerm, () => {
  scheduleThreadSearch()
})

onMounted(() => {
  if (typeof window === 'undefined') {
    return
  }

  platform.value = navigator.platform
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  clearThreadSearchTimer()

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
        :loading="projectsLoading || chatsLoading || threadSearchLoading"
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

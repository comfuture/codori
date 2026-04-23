<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { useRoute } from '#imports'
import { computed, onMounted, watch } from 'vue'
import { useProjects } from '../composables/useProjects'
import { useRpc } from '../composables/useRpc'
import { useThreadPanel } from '../composables/useThreadPanel'
import {
  resolveThreadSummaryTitle,
  useThreadSummaries,
  type ThreadSummary
} from '../composables/useThreadSummaries'
import type { ThreadListResponse } from '~~/shared/generated/codex-app-server/v2/ThreadListResponse'
import { toProjectThreadRoute } from '~~/shared/codori'

const props = defineProps<{
  projectId: string | null
  autoCloseOnSelect?: boolean
}>()

type ThreadNavigationItem = NavigationMenuItem & {
  updatedAt: number
}

const route = useRoute()
const { loaded, refreshProjects, startProject, getProject } = useProjects()
const { getClient } = useRpc()
const { closePanel } = useThreadPanel()
const resolveThreadSummaryKey = (projectId: string | null) =>
  projectId ? `project:${projectId}` : '__missing-project__'
const currentThreadSummaries = () => useThreadSummaries(resolveThreadSummaryKey(props.projectId))
const threads = computed(() => currentThreadSummaries().threads.value)
const loading = computed(() => currentThreadSummaries().loading.value)
const error = computed(() => currentThreadSummaries().error.value)

const project = computed(() => getProject(props.projectId))

const fetchThreads = async () => {
  const threadSummaries = currentThreadSummaries()
  if (!props.projectId || threadSummaries.loading.value) {
    return
  }

  threadSummaries.setLoading(true)
  threadSummaries.setError(null)

  try {
    if (!loaded.value) {
      await refreshProjects()
    }

    if (project.value?.status !== 'running') {
      await startProject(props.projectId)
    }

    const client = getClient(props.projectId)
    const response = await client.request<ThreadListResponse>('thread/list', {
      limit: 50,
      cwd: project.value?.projectPath ?? null
    })

    threadSummaries.setThreads(response.data
      .map(thread => ({
        id: thread.id,
        title: resolveThreadSummaryTitle(thread),
        updatedAt: thread.updatedAt
      }))
    )
  } catch (caughtError) {
    threadSummaries.setError(caughtError instanceof Error ? caughtError.message : String(caughtError))
  } finally {
    threadSummaries.setLoading(false)
  }
}
const activeThreadId = computed(() => {
  const value = route.params.threadId
  return typeof value === 'string' ? value : null
})

const threadItems = computed<ThreadNavigationItem[][]>(() => {
  if (!props.projectId) {
    return [[]]
  }

  return [threads.value.map((thread: ThreadSummary) => ({
    label: thread.title,
    icon: 'i-lucide-message-square-text',
    to: toProjectThreadRoute(props.projectId!, thread.id),
    active: activeThreadId.value === thread.id,
    onSelect: () => {
      if (props.autoCloseOnSelect) {
        closePanel()
      }
    },
    tooltip: {
      text: thread.title
    },
    updatedAt: thread.updatedAt
  }))]
})

const asThreadItem = (item: NavigationMenuItem) => item as ThreadNavigationItem

onMounted(() => {
  void fetchThreads()
})

watch(() => props.projectId, () => {
  currentThreadSummaries().setThreads([])
  void fetchThreads()
}, { immediate: true })

watch(() => route.fullPath, () => {
  void fetchThreads()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div
      v-if="error"
      class="px-3 py-3"
    >
      <UAlert
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        :title="error"
      />
    </div>

    <div
      v-if="!threads.length && !loading && !error"
      class="px-3 py-3 text-sm text-muted"
    >
      No previous threads were found for this project.
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      <UNavigationMenu
        v-if="threads.length"
        :items="threadItems"
        orientation="vertical"
        highlight
        color="primary"
        variant="link"
        :popover="false"
        class="w-full"
        :ui="{
          root: 'w-full',
          list: 'gap-1',
          item: 'w-full',
          link: 'w-full rounded-lg px-3 py-2.5 text-sm',
          linkLeadingIcon: 'size-4 text-dimmed',
          linkLabel: 'min-w-0 flex-1',
          linkTrailing: 'hidden'
        }"
      >
        <template #item-label="{ item }">
          <div class="truncate font-medium text-highlighted">
            {{ asThreadItem(item).label }}
          </div>
        </template>
      </UNavigationMenu>
    </div>
  </div>
</template>

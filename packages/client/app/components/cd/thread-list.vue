<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'
import { useCodoriProjects } from '../../composables/useCodoriProjects.js'
import { useCodoriRpc } from '../../composables/useCodoriRpc.js'
import type { ThreadListResponse } from '~~/shared/codex-rpc.js'
import { toProjectThreadRoute } from '~~/shared/codori.js'

const props = defineProps<{
  projectId: string | null
}>()

type ThreadSummary = {
  id: string
  title: string
  updatedAt: number
}

const route = useRoute()
const router = useRouter()
const { loaded, refreshProjects, startProject, getProject } = useCodoriProjects()
const { getClient } = useCodoriRpc()

const threads = ref<ThreadSummary[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

const project = computed(() => getProject(props.projectId))

const fetchThreads = async () => {
  if (!props.projectId || loading.value) {
    return
  }

  loading.value = true
  error.value = null

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

    threads.value = response.data
      .map(thread => ({
        id: thread.id,
        title: (thread.name ?? thread.preview.trim()) || thread.id,
        updatedAt: thread.updatedAt
      }))
      .sort((left, right) => right.updatedAt - left.updatedAt)
  } catch (caughtError) {
    error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
  } finally {
    loading.value = false
  }
}

const openThread = async (threadId: string) => {
  if (!props.projectId) {
    return
  }

  await router.push(toProjectThreadRoute(props.projectId, threadId))
}

onMounted(() => {
  void fetchThreads()
})

watch(() => props.projectId, () => {
  threads.value = []
  void fetchThreads()
}, { immediate: true })

watch(() => route.fullPath, () => {
  void fetchThreads()
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div class="flex items-center justify-between gap-2 px-4 py-3">
      <div class="text-xs font-medium uppercase tracking-[0.24em] text-muted">
        Sessions
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="loading"
        @click="fetchThreads"
      />
    </div>

    <div
      v-if="error"
      class="px-4 pb-3"
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
      class="px-4 pb-4 text-sm text-muted"
    >
      No previous threads were found for this project.
    </div>

    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
      <button
        v-for="thread in threads"
        :key="thread.id"
        type="button"
        class="w-full rounded-2xl border border-default px-3 py-3 text-left transition hover:border-primary/30 hover:bg-muted/40"
        @click="openThread(thread.id)"
      >
        <div class="truncate text-sm font-medium">
          {{ thread.title }}
        </div>
        <div class="mt-1 truncate text-[11px] text-muted">
          {{ thread.id }}
        </div>
      </button>
    </div>
  </div>
</template>

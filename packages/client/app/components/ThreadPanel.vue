<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useThreadPanel } from '../composables/useThreadPanel'
import ThreadList from './ThreadList.vue'

defineProps<{
  projectId: string | null
}>()

const { open, closePanel } = useThreadPanel()
const threadListKey = ref(0)
const isDesktopViewport = ref(false)

let viewportQuery: MediaQueryList | null = null
let removeViewportListener: (() => void) | null = null

const refreshThreads = () => {
  threadListKey.value += 1
}

onMounted(() => {
  if (!import.meta.client) {
    return
  }

  viewportQuery = window.matchMedia('(min-width: 1280px)')
  isDesktopViewport.value = viewportQuery.matches

  const handleViewportChange = (event: MediaQueryListEvent) => {
    isDesktopViewport.value = event.matches
  }

  viewportQuery.addEventListener('change', handleViewportChange)
  removeViewportListener = () => {
    viewportQuery?.removeEventListener('change', handleViewportChange)
  }
})

onBeforeUnmount(() => {
  removeViewportListener?.()
})
</script>

<template>
  <aside
    v-if="projectId && open && isDesktopViewport"
    class="hidden h-full min-h-0 w-[22rem] shrink-0 flex-col border-l border-default bg-default xl:flex"
  >
    <div class="flex items-center justify-between gap-2 border-b border-default px-3 py-2">
      <div class="text-sm font-medium text-highlighted">
        Resume Threads
      </div>
      <div class="flex items-center gap-1">
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          @click="refreshThreads"
        />
        <UButton
          icon="i-lucide-panel-right-close"
          color="neutral"
          variant="ghost"
          size="xs"
          square
          @click="closePanel"
        />
      </div>
    </div>
    <div class="min-h-0 flex-1 overflow-hidden">
      <ThreadList
        :key="threadListKey"
        :project-id="projectId"
      />
    </div>
  </aside>

  <USlideover
    v-if="projectId && !isDesktopViewport"
    v-model:open="open"
    title="Resume Threads"
    side="right"
    dismissible
    :ui="{
      content: 'w-[80vw] max-w-[80vw] sm:w-80 sm:max-w-80',
      header: 'px-3 py-2',
      body: '!p-0 sm:!p-0'
    }"
  >
    <template #actions>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="xs"
        square
        @click="refreshThreads"
      />
    </template>
    <template #body>
      <ThreadList
        :key="`mobile-${threadListKey}`"
        :project-id="projectId"
        auto-close-on-select
      />
    </template>
  </USlideover>
</template>

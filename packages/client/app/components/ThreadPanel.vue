<script setup lang="ts">
import { ref } from 'vue'
import { useThreadPanel } from '../composables/useThreadPanel.js'
import ThreadList from './ThreadList.vue'

defineProps<{
  projectId: string | null
}>()

const { open, closePanel } = useThreadPanel()
const threadListKey = ref(0)

const refreshThreads = () => {
  threadListKey.value += 1
}
</script>

<template>
  <div class="hidden h-full min-h-0 xl:flex">
    <UDashboardPanel
      v-if="projectId && open"
      id="thread-panel"
      :ui="{ body: 'p-0' }"
      class="h-full min-h-0 border-l border-default"
      :default-size="24"
      :min-size="20"
      :max-size="30"
      resizable
    >
      <template #header>
        <div class="flex items-center justify-between gap-2 px-3 py-2">
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
      </template>
      <template #body>
        <ThreadList
          :key="threadListKey"
          :project-id="projectId"
        />
      </template>
    </UDashboardPanel>
  </div>

  <USlideover
    v-if="projectId"
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

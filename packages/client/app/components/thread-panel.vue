<script setup lang="ts">
import { useThreadPanel } from '../composables/useThreadPanel.js'
import ThreadList from './thread-list.vue'

defineProps<{
  projectId: string | null
}>()

const { open, closePanel } = useThreadPanel()
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
        <div class="flex items-center justify-between px-4 py-3">
          <div>
            <div class="text-sm font-semibold">
              Previous Threads
            </div>
            <div class="text-xs text-muted">
              {{ projectId }}
            </div>
          </div>
          <UButton
            icon="i-lucide-panel-right-close"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="closePanel"
          />
        </div>
      </template>
      <template #body>
        <ThreadList :project-id="projectId" />
      </template>
    </UDashboardPanel>
  </div>

  <USlideover
    v-if="projectId"
    v-model:open="open"
    title="Previous Threads"
    description="Thread history becomes available when chat transport is connected."
    side="right"
  >
    <template #body>
      <ThreadList :project-id="projectId" />
    </template>
  </USlideover>
</template>

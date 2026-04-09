<script setup lang="ts">
import { useThreadPanel } from '../../composables/useThreadPanel.js'

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
        <div class="p-4 text-sm text-muted">
          Thread history becomes available when chat transport is connected.
        </div>
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
      <div class="space-y-2 p-4 text-sm text-muted">
        <div class="font-medium text-default">
          {{ projectId }}
        </div>
        <p>
          This panel is wired and ready. Thread list and resume behavior will be populated by the chat transport layer.
        </p>
      </div>
    </template>
  </USlideover>
</template>

<script setup lang="ts">
import { useRoute } from '#imports'
import { computed } from 'vue'
import { useThreadPanel } from '../../../../composables/useThreadPanel.js'
import { normalizeProjectIdParam } from '../../../../../shared/codori.js'

const route = useRoute()
const { openPanel } = useThreadPanel()

const projectId = computed(() => normalizeProjectIdParam(route.params.projectId as string | string[] | undefined))
const threadId = computed(() => {
  const value = route.params.threadId
  return typeof value === 'string' ? decodeURIComponent(value) : null
})
</script>

<template>
  <div class="flex h-screen min-h-0 flex-1 min-w-0">
    <UDashboardPanel
      id="thread-shell"
      class="min-h-0"
      :min-size="50"
      :max-size="100"
      :default-size="100"
      :resizable="false"
    >
      <template #header>
        <UDashboardNavbar :title="threadId ?? 'Thread'">
          <template #right>
            <div class="flex items-center gap-2">
              <UButton
                icon="i-lucide-history"
                color="neutral"
                variant="outline"
                label="Previous threads"
                @click="openPanel"
              />
            </div>
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          <UAlert
            color="info"
            variant="soft"
            icon="i-lucide-waypoints"
            :title="projectId ?? 'Project'"
            :description="threadId ? `Thread ${threadId} is selected. Resume and transcript hydration will be enabled by the chat integration commit.` : 'Select a thread.'"
          />
          <cd-tunnel-notice />
        </div>
      </template>
    </UDashboardPanel>

    <cd-thread-panel :project-id="projectId" />
  </div>
</template>

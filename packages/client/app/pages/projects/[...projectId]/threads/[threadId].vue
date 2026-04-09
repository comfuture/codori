<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed } from 'vue'
import { useThreadPanel } from '../../../../composables/useThreadPanel.js'
import { normalizeProjectIdParam, toProjectRoute } from '~~/shared/codori.js'

const route = useRoute()
const router = useRouter()
const { openPanel } = useThreadPanel()

const projectId = computed(() => normalizeProjectIdParam(route.params.projectId as string | string[] | undefined))
const threadId = computed(() => {
  const value = route.params.threadId
  return typeof value === 'string' ? value : null
})

const onNewThread = async () => {
  if (!projectId.value) {
    return
  }

  await router.push(toProjectRoute(projectId.value))
}
</script>

<template>
  <div class="flex h-screen min-h-0 flex-1 min-w-0">
    <UDashboardPanel
      id="thread-shell"
      class="min-h-0 min-w-0 flex-1"
      :ui="{ root: '!p-0', body: '!p-0 sm:!p-0 !gap-0 sm:!gap-0' }"
    >
      <template #header>
        <UDashboardNavbar
          :title="threadId ?? 'Thread'"
          icon="i-lucide-message-square-text"
        >
          <template #right>
            <div class="flex items-center gap-2">
              <UTooltip text="New thread">
                <UButton
                  icon="i-lucide-plus"
                  color="primary"
                  variant="soft"
                  square
                  @click="onNewThread"
                />
              </UTooltip>
              <UTooltip text="Previous threads">
                <UButton
                  icon="i-lucide-history"
                  color="neutral"
                  variant="outline"
                  square
                  @click="openPanel"
                />
              </UTooltip>
            </div>
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <ChatWorkspace
          v-if="projectId"
          :project-id="projectId"
          :thread-id="threadId"
          class="min-h-0 flex-1"
        />
      </template>
    </UDashboardPanel>

    <ThreadPanel :project-id="projectId" />
  </div>
</template>

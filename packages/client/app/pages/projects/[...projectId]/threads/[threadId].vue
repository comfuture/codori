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
      class="min-h-0"
      :ui="{ body: 'p-0' }"
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
                icon="i-lucide-plus"
                color="primary"
                variant="soft"
                label="New thread"
                @click="onNewThread"
              />
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
        <div class="flex h-full min-h-0 flex-col">
          <TunnelNotice class="m-4 mb-0 shrink-0 md:m-6 md:mb-0" />
          <ChatWorkspace
            v-if="projectId"
            :project-id="projectId"
            :thread-id="threadId"
            class="min-h-0 flex-1"
          />
        </div>
      </template>
    </UDashboardPanel>

    <ThreadPanel :project-id="projectId" />
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed } from 'vue'
import CdChatWorkspace from '../../../../components/cd/chat-workspace.vue'
import CdThreadPanel from '../../../../components/cd/thread-panel.vue'
import CdTunnelNotice from '../../../../components/cd/tunnel-notice.vue'
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
          <cd-tunnel-notice class="m-4 mb-0 shrink-0 md:m-6 md:mb-0" />
          <cd-chat-workspace
            v-if="projectId"
            :project-id="projectId"
            :thread-id="threadId"
            class="min-h-0 flex-1"
          />
        </div>
      </template>
    </UDashboardPanel>

    <cd-thread-panel :project-id="projectId" />
  </div>
</template>

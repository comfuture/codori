<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted } from 'vue'
import { useChatSession } from '../../../../composables/useChatSession.js'
import { useProjects } from '../../../../composables/useProjects.js'
import { useThreadPanel } from '../../../../composables/useThreadPanel.js'
import { normalizeProjectIdParam, toProjectRoute } from '~~/shared/codori.js'

const route = useRoute()
const router = useRouter()
const { openPanel } = useThreadPanel()
const { loaded, refreshProjects, getProject, pendingProjectId } = useProjects()

const projectId = computed(() => normalizeProjectIdParam(route.params.projectId as string | string[] | undefined))
const threadId = computed(() => {
  const value = route.params.threadId
  return typeof value === 'string' ? value : null
})
const selectedProject = computed(() => getProject(projectId.value))
const projectName = computed(() => selectedProject.value?.projectId ?? projectId.value ?? 'Project')
const threadTitle = computed(() => {
  if (!projectId.value) {
    return threadId.value ?? 'Thread'
  }

  return useChatSession(projectId.value).threadTitle.value ?? threadId.value ?? 'Thread'
})
const rpcStatus = computed(() => {
  if (!projectId.value) {
    return 'Offline'
  }

  if (pendingProjectId.value === projectId.value) {
    return 'Starting'
  }

  switch (selectedProject.value?.status) {
    case 'running':
      return 'Running'
    case 'stopped':
      return 'Stopped'
    case 'error':
      return 'Error'
    default:
      return 'Checking'
  }
})

const onNewThread = async () => {
  if (!projectId.value) {
    return
  }

  await router.push(toProjectRoute(projectId.value))
}

onMounted(() => {
  if (!loaded.value) {
    void refreshProjects()
  }
})
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
          icon="i-lucide-message-square-text"
          :ui="{
            title: 'min-w-0',
            left: 'min-w-0',
            right: 'shrink-0'
          }"
        >
          <template #title>
            <div class="min-w-0 space-y-0.5">
              <div class="min-w-0">
                <div class="truncate text-xs font-medium uppercase tracking-[0.22em] text-muted">
                  {{ projectName }}
                </div>
              </div>
              <div class="min-w-0">
                <div class="truncate text-sm font-medium text-highlighted">
                  {{ threadTitle }}
                </div>
              </div>
            </div>
          </template>
          <template #right>
            <div class="flex items-center gap-2">
              <UTooltip :text="`RPC ${rpcStatus}`">
                <ProjectStatusDot
                  :status="rpcStatus"
                  pulse
                  padded
                />
              </UTooltip>
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

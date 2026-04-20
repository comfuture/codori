<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted } from 'vue'
import { useProjects } from '../../../composables/useProjects'
import { useThreadPanel } from '../../../composables/useThreadPanel'
import { normalizeProjectIdParam } from '~~/shared/codori'

const route = useRoute()
const router = useRouter()
const { togglePanel } = useThreadPanel()
const { loaded, refreshProjects, getProject, pendingProjectId } = useProjects()

const projectId = computed(() => normalizeProjectIdParam(route.params.projectId as string | string[] | undefined))
const selectedProject = computed(() => getProject(projectId.value))
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
  await router.push(`/projects/${projectId.value}`)
}

onMounted(() => {
  if (!loaded.value) {
    void refreshProjects()
  }
})
</script>

<template>
  <div class="app-shell-height flex h-screen h-dvh min-h-0 flex-1 min-w-0">
    <UDashboardPanel
      id="project-shell"
      class="min-h-0 min-w-0 flex-1"
      :ui="{ root: '!p-0', body: '!p-0 sm:!p-0 !gap-0 sm:!gap-0' }"
    >
      <template #header>
        <UDashboardNavbar
          :title="projectId ?? 'Project'"
          icon="i-lucide-folder-git-2"
        >
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
                  @click="togglePanel"
                />
              </UTooltip>
            </div>
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <ChatWorkspace
          :project-id="projectId ?? ''"
          class="min-h-0 flex-1"
        />
      </template>
    </UDashboardPanel>

    <ThreadPanel :project-id="projectId" />
  </div>
</template>

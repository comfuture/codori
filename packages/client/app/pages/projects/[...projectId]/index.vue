<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted } from 'vue'
import WorkspaceFilesPanel from '../../../components/WorkspaceFilesPanel.vue'
import { useProjects } from '../../../composables/useProjects'
import WorkspaceTerminalToggle from '../../../components/WorkspaceTerminalToggle.vue'
import { normalizeProjectIdParam, toProjectRoute } from '~~/shared/codori'

const route = useRoute()
const router = useRouter()
const {
  loaded,
  refreshProjects,
  getProject
} = useProjects()

const projectId = computed(() => normalizeProjectIdParam(route.params.projectId as string | string[] | undefined))
const selectedProject = computed(() => getProject(projectId.value))
const projectName = computed(() => selectedProject.value?.projectId ?? projectId.value ?? 'Project')

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
  <div class="app-shell-height flex h-screen h-dvh min-h-0 flex-1 min-w-0">
    <UDashboardPanel
      id="project-shell"
      class="min-h-0 min-w-0 flex-1"
      :ui="{ root: '!p-0', body: '!p-0 sm:!p-0 !gap-0 sm:!gap-0' }"
    >
      <template #header>
        <UDashboardNavbar
          :title="projectName"
          icon="i-lucide-folder-git-2"
        >
          <template #right>
            <div class="flex items-center gap-2">
              <WorkspaceFilesPanel
                v-if="projectId"
                :workspace="{ kind: 'project', id: projectId }"
                :workspace-label="projectName"
              />
              <UTooltip text="New thread">
                <UButton
                  icon="i-lucide-plus"
                  color="primary"
                  variant="soft"
                  square
                  @click="onNewThread"
                />
              </UTooltip>
            </div>
            <WorkspaceTerminalToggle
              v-if="projectId"
              :workspace="{ kind: 'project', id: projectId }"
            />
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
  </div>
</template>

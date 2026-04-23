<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted } from 'vue'
import { useProjects } from '../../../composables/useProjects'
import { useThreadPanel } from '../../../composables/useThreadPanel'
import { isProjectlessProjectId, normalizeProjectIdParam, toProjectRoute } from '~~/shared/codori'

const route = useRoute()
const router = useRouter()
const { togglePanel } = useThreadPanel()
const {
  loaded,
  projectlessLoaded,
  refreshProjects,
  refreshProjectlessChats,
  getProject
} = useProjects()

const projectId = computed(() => normalizeProjectIdParam(route.params.projectId as string | string[] | undefined))
const selectedProject = computed(() => getProject(projectId.value))
const isProjectlessProject = computed(() =>
  selectedProject.value?.workspaceKind === 'projectless'
  || isProjectlessProjectId(projectId.value)
)
const projectName = computed(() => {
  if (isProjectlessProject.value) {
    return selectedProject.value?.title?.trim() || 'New Chat'
  }

  return selectedProject.value?.projectId ?? projectId.value ?? 'Project'
})
const projectIcon = computed(() =>
  isProjectlessProject.value
    ? 'i-lucide-message-square'
    : 'i-lucide-folder-git-2'
)

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
  if (projectId.value?.startsWith('projectless/') && !projectlessLoaded.value) {
    void refreshProjectlessChats()
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
          :icon="projectIcon"
        >
          <template
            v-if="!isProjectlessProject"
            #right
          >
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

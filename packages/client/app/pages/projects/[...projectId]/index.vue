<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted } from 'vue'
import { useProjects } from '../../../composables/useProjects.js'
import { useThreadPanel } from '../../../composables/useThreadPanel.js'
import {
  normalizeProjectIdParam,
  projectStatusMeta
} from '~~/shared/codori.js'

const route = useRoute()
const router = useRouter()
const { openPanel } = useThreadPanel()
const { loaded, getProject, refreshProjects, startProject, stopProject, pendingProjectId } = useProjects()

const projectId = computed(() => normalizeProjectIdParam(route.params.projectId as string | string[] | undefined))
const project = computed(() => getProject(projectId.value))

onMounted(() => {
  if (!loaded.value) {
    void refreshProjects()
  }
})

const onStartOrStop = async () => {
  if (!projectId.value || !project.value) {
    return
  }

  if (project.value.status === 'running') {
    await stopProject(projectId.value)
    return
  }

  await startProject(projectId.value)
}

const onNewThread = async () => {
  if (!projectId.value) {
    return
  }
  await router.push(`/projects/${projectId.value}`)
}
</script>

<template>
  <div class="flex h-screen min-h-0 flex-1 min-w-0">
    <UDashboardPanel
      id="project-shell"
      class="min-h-0 min-w-0 flex-1"
      :ui="{ body: 'p-0' }"
    >
      <template #header>
        <UDashboardNavbar :title="projectId ?? 'Project'">
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
          <div
            v-if="project"
            class="shrink-0 border-b border-default px-4 py-4 md:px-6"
          >
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="text-xs font-medium uppercase tracking-[0.24em] text-muted">
                  Selected project
                </div>
                <h1 class="mt-1 truncate text-xl font-semibold text-highlighted md:text-2xl">
                  {{ project.projectId }}
                </h1>
                <p class="mt-1 truncate text-sm text-muted">
                  {{ project.projectPath }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <UBadge
                  :color="projectStatusMeta(project.status).color"
                  variant="soft"
                >
                  {{ projectStatusMeta(project.status).label }}
                </UBadge>
                <span
                  v-if="project.port"
                  class="text-sm text-muted"
                >
                  :{{ project.port }}
                </span>
                <UButton
                  :label="project.status === 'running' ? 'Stop runtime' : 'Start runtime'"
                  :loading="pendingProjectId === project.projectId"
                  :color="project.status === 'running' ? 'neutral' : 'primary'"
                  :variant="project.status === 'running' ? 'outline' : 'soft'"
                  @click="onStartOrStop"
                />
              </div>
            </div>
          </div>

          <TunnelNotice class="m-4 mb-0 shrink-0 md:m-6 md:mb-0" />

          <ChatWorkspace
            :project-id="projectId ?? ''"
            class="min-h-0 flex-1"
          />
        </div>
      </template>
    </UDashboardPanel>

    <ThreadPanel :project-id="projectId" />
  </div>
</template>

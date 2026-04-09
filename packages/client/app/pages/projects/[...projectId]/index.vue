<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted } from 'vue'
import { useCodoriProjects } from '../../../composables/useCodoriProjects.js'
import { useThreadPanel } from '../../../composables/useThreadPanel.js'
import {
  normalizeProjectIdParam,
  projectStatusMeta
} from '~~/shared/codori.js'

const route = useRoute()
const router = useRouter()
const { openPanel } = useThreadPanel()
const { loaded, getProject, refreshProjects, startProject, stopProject, pendingProjectId } = useCodoriProjects()

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
      class="min-h-0"
      :min-size="50"
      :max-size="100"
      :default-size="100"
      :resizable="false"
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
        <div class="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
          <UCard v-if="project">
            <template #header>
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div class="text-xs font-medium uppercase tracking-[0.24em] text-muted">
                    Selected project
                  </div>
                  <h1 class="mt-1 text-2xl font-semibold">
                    {{ project.projectId }}
                  </h1>
                  <p class="mt-2 text-sm text-muted">
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
                  <UButton
                    :label="project.status === 'running' ? 'Stop runtime' : 'Start runtime'"
                    :loading="pendingProjectId === project.projectId"
                    :color="project.status === 'running' ? 'neutral' : 'primary'"
                    :variant="project.status === 'running' ? 'outline' : 'soft'"
                    @click="onStartOrStop"
                  />
                </div>
              </div>
            </template>

            <div class="grid gap-4 md:grid-cols-3">
              <div class="rounded-2xl border border-default p-4">
                <div class="text-sm font-medium">
                  Runtime
                </div>
                <p class="mt-2 text-sm text-muted">
                  {{ project.status === 'running'
                    ? `Listening on port ${project.port}`
                    : 'Runtime is currently stopped.' }}
                </p>
              </div>
              <div class="rounded-2xl border border-default p-4">
                <div class="text-sm font-medium">
                  Threads
                </div>
                <p class="mt-2 text-sm text-muted">
                  Use the navbar to create a new thread or inspect previous sessions.
                </p>
              </div>
              <div class="rounded-2xl border border-default p-4">
                <div class="text-sm font-medium">
                  RPC channel
                </div>
                <p class="mt-2 text-sm text-muted">
                  Chat transport will attach to the project through the Codori WebSocket proxy.
                </p>
              </div>
            </div>
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-lucide-messages-square"
                  class="size-5 text-primary"
                />
                <div class="text-lg font-semibold">
                  Chat workspace
                </div>
              </div>
            </template>
            <cd-chat-workspace :project-id="projectId ?? ''" />
          </UCard>

          <cd-tunnel-notice />
        </div>
      </template>
    </UDashboardPanel>

    <cd-thread-panel :project-id="projectId" />
  </div>
</template>

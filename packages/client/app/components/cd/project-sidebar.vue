<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted } from 'vue'
import { useCodoriProjects } from '../../composables/useCodoriProjects.js'
import { projectStatusMeta, toProjectRoute } from '~~/shared/codori.js'

const props = defineProps<{
  collapsed?: boolean
}>()

const route = useRoute()
const router = useRouter()
const {
  projects,
  loaded,
  loading,
  pendingProjectId,
  refreshProjects,
  startProject,
  stopProject
} = useCodoriProjects()

const activeProjectId = computed(() => {
  const param = route.params.projectId
  if (Array.isArray(param)) {
    return param.join('/')
  }
  return typeof param === 'string' ? param : null
})

onMounted(() => {
  if (!loaded.value) {
    void refreshProjects()
  }
})

const navigateToProject = async (projectId: string) => {
  await router.push(toProjectRoute(projectId))
}

const onToggleProject = async (projectId: string, status: 'running' | 'stopped' | 'error') => {
  if (status === 'running') {
    await stopProject(projectId)
    return
  }

  await startProject(projectId)
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="flex items-center justify-between gap-2">
      <div
        v-if="!props.collapsed"
        class="text-xs font-medium uppercase tracking-[0.24em] text-muted"
      >
        Projects
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="xs"
        :loading="loading"
        :square="props.collapsed"
        @click="refreshProjects"
      />
    </div>

    <div
      v-if="!projects.length && !loading"
      class="rounded-xl border border-dashed border-muted px-3 py-4 text-sm text-muted"
    >
      <span v-if="props.collapsed">0</span>
      <span v-else>No Git projects were discovered under the configured root.</span>
    </div>

    <div class="min-h-0 flex-1 space-y-2 overflow-y-auto">
      <button
        v-for="project in projects"
        :key="project.projectId"
        type="button"
        class="w-full rounded-2xl border px-3 py-3 text-left transition"
        :class="activeProjectId === project.projectId
          ? 'border-primary/60 bg-primary/8 shadow-sm'
          : 'border-default hover:border-primary/30 hover:bg-muted/40'"
        @click="navigateToProject(project.projectId)"
      >
        <div
          class="flex items-start gap-3"
          :class="props.collapsed ? 'justify-center' : 'justify-between'"
        >
          <div
            v-if="props.collapsed"
            class="flex flex-col items-center gap-1"
          >
            <UIcon
              name="i-lucide-folder-git-2"
              class="size-4"
            />
            <span class="text-[10px] font-medium uppercase text-muted">
              {{ project.status.slice(0, 1) }}
            </span>
          </div>

          <template v-else>
            <div class="min-w-0 space-y-2">
              <div class="truncate font-medium">
                {{ project.projectId }}
              </div>
              <div class="truncate text-xs text-muted">
                {{ project.projectPath }}
              </div>
              <div class="flex items-center gap-2">
                <UBadge
                  :color="projectStatusMeta(project.status).color"
                  variant="soft"
                  size="sm"
                >
                  {{ projectStatusMeta(project.status).label }}
                </UBadge>
                <span
                  v-if="project.port"
                  class="text-[11px] text-muted"
                >
                  :{{ project.port }}
                </span>
              </div>
              <p
                v-if="project.error"
                class="text-xs text-error"
              >
                {{ project.error }}
              </p>
            </div>

            <UButton
              :label="project.status === 'running' ? 'Stop' : 'Start'"
              :color="project.status === 'running' ? 'neutral' : 'primary'"
              :variant="project.status === 'running' ? 'outline' : 'soft'"
              size="xs"
              :loading="pendingProjectId === project.projectId"
              @click.stop="onToggleProject(project.projectId, project.status)"
            />
          </template>
        </div>
      </button>
    </div>
  </div>
</template>

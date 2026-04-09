<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { useRoute } from '#imports'
import { computed, onMounted } from 'vue'
import { useProjects } from '../composables/useProjects.js'
import { projectStatusMeta, toProjectRoute } from '~~/shared/codori.js'

const props = defineProps<{
  collapsed?: boolean
}>()
type ProjectNavigationItem = NavigationMenuItem & {
  projectId: string
  projectPath: string
  status: 'running' | 'stopped' | 'error'
  port: number | null
  error: string | null
}

const route = useRoute()
const {
  projects,
  loaded,
  loading,
  refreshProjects
} = useProjects()

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

const projectItems = computed<ProjectNavigationItem[][]>(() => [
  projects.value.map(project => ({
    label: project.projectId,
    icon: 'i-lucide-folder-git-2',
    to: toProjectRoute(project.projectId),
    active: activeProjectId.value === project.projectId,
    tooltip: {
      text: project.projectId
    },
    projectId: project.projectId,
    projectPath: project.projectPath,
    status: project.status,
    port: project.port,
    error: project.error
  }))
])

const asProjectItem = (item: NavigationMenuItem) => item as ProjectNavigationItem

const statusDotClass = (status: ProjectNavigationItem['status']) => {
  switch (status) {
    case 'running':
      return 'bg-success ring-success/20'
    case 'error':
      return 'bg-error ring-error/20'
    default:
      return 'bg-muted ring-default'
  }
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
      class="rounded-lg border border-dashed border-muted px-3 py-4 text-sm text-muted"
    >
      <span v-if="props.collapsed">0</span>
      <span v-else>No Git projects were discovered under the configured root.</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <UNavigationMenu
        :items="projectItems"
        orientation="vertical"
        :collapsed="props.collapsed"
        highlight
        color="primary"
        variant="link"
        :popover="false"
        :tooltip="props.collapsed"
        class="w-full"
        :ui="{
          root: 'w-full',
          list: 'gap-1',
          item: 'w-full',
          link: props.collapsed
            ? 'w-full justify-center rounded-lg px-2 py-2'
            : 'w-full rounded-lg px-3 py-2.5 text-sm',
          linkLeadingIcon: props.collapsed ? 'size-4' : 'size-4 text-dimmed',
          linkLabel: 'min-w-0 flex-1',
          linkTrailing: 'ms-3 shrink-0'
        }"
      >
        <template #item-label="{ item }">
          <div
            v-if="!props.collapsed"
            class="min-w-0"
          >
            <div class="truncate font-medium text-highlighted">
              {{ asProjectItem(item).projectId }}
            </div>
            <div class="truncate text-[11px] text-muted">
              {{ asProjectItem(item).projectPath }}
            </div>
            <div
              v-if="asProjectItem(item).error"
              class="truncate text-[11px] text-error"
            >
              {{ asProjectItem(item).error }}
            </div>
          </div>
        </template>

        <template #item-trailing="{ item }">
          <div
            v-if="!props.collapsed"
            class="flex items-center gap-2"
          >
            <span
              class="size-2 rounded-full ring-4"
              :class="statusDotClass(asProjectItem(item).status)"
            />
            <UBadge
              :color="projectStatusMeta(asProjectItem(item).status).color"
              variant="soft"
              size="sm"
            >
              {{ projectStatusMeta(asProjectItem(item).status).label }}
            </UBadge>
            <span
              v-if="asProjectItem(item).port"
              class="text-[11px] text-muted"
            >
              :{{ asProjectItem(item).port }}
            </span>
          </div>
        </template>
      </UNavigationMenu>
    </div>
  </div>
</template>

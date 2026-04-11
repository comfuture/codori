<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onMounted, ref, watch } from 'vue'
import { useChatSession } from '../../../../composables/useChatSession'
import { useProjects } from '../../../../composables/useProjects'
import { useThreadPanel } from '../../../../composables/useThreadPanel'
import { useVisualSubagentPanels } from '../../../../composables/useVisualSubagentPanels'
import { normalizeProjectIdParam, toProjectRoute } from '~~/shared/codori'

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
const subagentPanels = computed(() =>
  projectId.value ? useChatSession(projectId.value).subagentPanels.value : []
)
const { availablePanels, activePanels } = useVisualSubagentPanels(() => subagentPanels.value)
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
const isSubagentsPanelOpen = ref(false)
const hasUserToggledSubagentsPanel = ref(false)
const hasResolvedSubagentPanelState = ref(false)
const previousActiveSubagentCount = ref(0)
const hasAvailableSubagents = computed(() => availablePanels.value.length > 0)
const isSubagentsPanelVisible = computed(() =>
  isSubagentsPanelOpen.value && hasAvailableSubagents.value
)
const subagentsToggleIcon = computed(() =>
  isSubagentsPanelVisible.value
    ? 'i-lucide-panel-right-close'
    : 'i-lucide-panel-right-open'
)
const toSubagentAvatarText = (name: string) => {
  const normalized = name.replace(/\s+/g, '').trim()
  return Array.from(normalized || 'AG').slice(0, 2).join('')
}
const subagentAvatarItems = computed(() =>
  availablePanels.value.map((panel, index) => ({
    threadId: panel.threadId,
    name: panel.name,
    text: toSubagentAvatarText(panel.name),
    class: [
      'bg-emerald-500/15 text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-300',
      'bg-sky-500/15 text-sky-700 ring-1 ring-inset ring-sky-500/30 dark:text-sky-300',
      'bg-amber-500/15 text-amber-800 ring-1 ring-inset ring-amber-500/35 dark:text-amber-300',
      'bg-rose-500/15 text-rose-700 ring-1 ring-inset ring-rose-500/30 dark:text-rose-300',
      'bg-violet-500/15 text-violet-700 ring-1 ring-inset ring-violet-500/30 dark:text-violet-300'
    ][index % 5]
  }))
)

const toggleSubagentsPanel = () => {
  if (!hasAvailableSubagents.value) {
    return
  }
  hasUserToggledSubagentsPanel.value = true
  isSubagentsPanelOpen.value = !isSubagentsPanelOpen.value
}

const closeSubagentsPanel = () => {
  hasUserToggledSubagentsPanel.value = true
  isSubagentsPanelOpen.value = false
}

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

watch(threadId, () => {
  hasUserToggledSubagentsPanel.value = false
  hasResolvedSubagentPanelState.value = false
  previousActiveSubagentCount.value = 0
  isSubagentsPanelOpen.value = false
}, { immediate: true })

watch(hasAvailableSubagents, (value) => {
  if (!value) {
    hasUserToggledSubagentsPanel.value = false
    hasResolvedSubagentPanelState.value = false
    previousActiveSubagentCount.value = 0
    isSubagentsPanelOpen.value = false
  }
}, { immediate: true })

watch(
  () => activePanels.value.length,
  (nextCount) => {
    if (!hasAvailableSubagents.value) {
      return
    }

    if (!hasResolvedSubagentPanelState.value) {
      hasResolvedSubagentPanelState.value = true
      previousActiveSubagentCount.value = nextCount
      isSubagentsPanelOpen.value = nextCount > 0
      return
    }

    if (!hasUserToggledSubagentsPanel.value
      && previousActiveSubagentCount.value === 0
      && nextCount > 0
    ) {
      isSubagentsPanelOpen.value = true
    }

    previousActiveSubagentCount.value = nextCount
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex h-screen min-h-0 flex-1 min-w-0">
    <UDashboardPanel
      id="thread-shell"
      class="min-h-0 min-w-0 flex-1"
      :default-size="isSubagentsPanelVisible ? 70 : undefined"
      :min-size="isSubagentsPanelVisible ? 50 : undefined"
      :max-size="isSubagentsPanelVisible ? 75 : undefined"
      :resizable="isSubagentsPanelVisible"
      :ui="{ root: '!p-0', body: '!p-0 sm:!p-0 !gap-0 sm:!gap-0' }"
    >
      <template #header>
        <UDashboardNavbar
          icon="i-lucide-message-square-text"
          :ui="{
            title: 'min-w-0 flex-1',
            left: 'min-w-0 flex-1',
            right: 'shrink-0'
          }"
        >
          <template #title>
            <div class="min-w-0 overflow-hidden pe-2 space-y-0.5">
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
            <div class="flex items-center gap-1.5 lg:gap-2">
              <UTooltip
                v-if="hasAvailableSubagents"
                text="Subagents"
              >
                <UButton
                  :color="isSubagentsPanelVisible ? 'primary' : 'neutral'"
                  :variant="isSubagentsPanelVisible ? 'soft' : 'ghost'"
                  :icon="subagentsToggleIcon"
                  size="sm"
                  class="px-2 xl:ps-2 xl:pe-2.5"
                  :aria-label="isSubagentsPanelVisible ? 'Hide subagents' : 'Show subagents'"
                  @click="toggleSubagentsPanel"
                >
                  <UAvatarGroup
                    class="hidden xl:flex"
                    size="xs"
                    :max="4"
                    :ui="{ base: 'ring-2 -me-2 first:me-0' }"
                  >
                    <UAvatar
                      v-for="agent in subagentAvatarItems"
                      :key="agent.threadId"
                      :text="agent.text"
                      :alt="agent.name"
                      :class="agent.class"
                    />
                  </UAvatarGroup>
                </UButton>
              </UTooltip>
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

    <UDashboardPanel
      v-if="isSubagentsPanelVisible"
      id="thread-subagents-panel"
      class="h-full min-h-0"
      :default-size="30"
      :min-size="20"
      :max-size="40"
      resizable
      :ui="{ header: '!p-0 bg-[var(--ui-bg)]', body: '!p-0' }"
    >
      <template #header>
        <div
          class="flex items-center justify-between gap-2 border-b border-default px-4 py-3"
          style="background-color: var(--ui-bg);"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-highlighted">Subagents</span>
            <UBadge
              color="primary"
              variant="soft"
              size="sm"
            >
              {{ availablePanels.length }}
            </UBadge>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Close subagents panel"
            @click="closeSubagentsPanel"
          />
        </div>
      </template>

      <template #body>
        <VisualSubagentStack
          :agents="availablePanels"
          class="h-full min-h-0"
        />
      </template>
    </UDashboardPanel>

    <ThreadPanel :project-id="projectId" />
  </div>
</template>

<script setup lang="ts">
import { useRoute } from '#imports'
import { computed, ref } from 'vue'
import { useProjects } from '../composables/useProjects'
import { DEFAULT_SETTINGS_ROUTE } from '~~/shared/settings'

const route = useRoute()
const sidebarCollapsed = ref(false)
const commandPaletteOpen = ref(false)
const { serviceUpdate, serviceUpdatePending, triggerServiceUpdate } = useProjects()

const showServiceUpdateButton = computed(() =>
  serviceUpdate.value.enabled && (serviceUpdate.value.updateAvailable || serviceUpdate.value.updating)
)

const serviceUpdateLabel = computed(() =>
  serviceUpdate.value.updating ? 'Updating' : 'Update'
)

const serviceUpdateTooltip = computed(() => {
  if (!serviceUpdate.value.latestVersion || !serviceUpdate.value.installedVersion) {
    return serviceUpdate.value.updating ? 'Applying the latest server package update.' : 'Install the latest @codori/server package.'
  }

  return serviceUpdate.value.updating
    ? `Updating @codori/server ${serviceUpdate.value.installedVersion} -> ${serviceUpdate.value.latestVersion}`
    : `Update @codori/server ${serviceUpdate.value.installedVersion} -> ${serviceUpdate.value.latestVersion}`
})

const handleServiceUpdate = async () => {
  await triggerServiceUpdate()
}

const sidebarUi = computed(() =>
  sidebarCollapsed.value
    ? {
        content: 'w-[80vw] max-w-[80vw] sm:w-80 sm:max-w-80',
        body: 'flex flex-col gap-4 flex-1 overflow-y-auto px-1 py-2',
        footer: 'overflow-visible'
      }
    : {
        content: 'w-[80vw] max-w-[80vw] sm:w-80 sm:max-w-80',
        footer: 'overflow-visible'
      }
)

const settingsRoute = computed(() => ({
  path: DEFAULT_SETTINGS_ROUTE,
  query: {
    returnTo: route.fullPath
  }
}))
</script>

<template>
  <UDashboardGroup
    class="app-shell-min-height min-h-screen min-h-dvh"
    storage="local"
    storage-key="codori-dashboard"
    :persistent="true"
    unit="%"
  >
    <UDashboardSidebar
      id="projects-sidebar"
      v-model:collapsed="sidebarCollapsed"
      side="left"
      collapsible
      :collapsed-size="6"
      resizable
      :default-size="24"
      :min-size="20"
      :max-size="34"
      :ui="sidebarUi"
      class="overflow-visible"
    >
      <template #header="{ collapsed }">
        <div class="flex items-center gap-3 px-1">
          <div class="flex size-9 items-center justify-center rounded-xl bg-primary/12 text-primary">
            <UIcon
              name="i-lucide-terminal-square"
              class="size-5"
            />
          </div>
          <div
            v-if="!collapsed"
            class="flex min-w-0 flex-1 items-start justify-between gap-3"
          >
            <div class="min-w-0">
              <div class="text-sm font-semibold">
                Codori
              </div>
              <div class="text-xs text-muted">
                Codex project control
              </div>
            </div>
            <UTooltip
              v-if="showServiceUpdateButton"
              :text="serviceUpdateTooltip"
            >
              <UButton
                color="neutral"
                variant="outline"
                size="xs"
                :loading="serviceUpdatePending || serviceUpdate.updating"
                :disabled="serviceUpdatePending || serviceUpdate.updating"
                @click="handleServiceUpdate"
              >
                {{ serviceUpdateLabel }}
              </UButton>
            </UTooltip>
          </div>
          <div
            v-else-if="collapsed"
            class="sr-only"
          >
            <span>
              Codori
            </span>
            <span>
              Codex project control
            </span>
          </div>
        </div>
      </template>

      <template #default="{ collapsed }">
        <ProjectSidebar
          :collapsed="collapsed"
          @open-command-palette="commandPaletteOpen = true"
        />
      </template>

      <template #footer>
        <div class="flex w-full items-center gap-2">
          <UTooltip text="Settings">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-settings"
              :label="sidebarCollapsed ? undefined : 'Settings'"
              aria-label="Open settings"
              :to="settingsRoute"
              :class="sidebarCollapsed ? 'justify-center' : 'min-w-0 flex-1 justify-start'"
            />
          </UTooltip>
          <UDashboardSidebarCollapse
            class="relative z-20 ms-auto shrink-0"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <GlobalCommandPalette v-model:open="commandPaletteOpen" />

    <slot />
  </UDashboardGroup>
</template>

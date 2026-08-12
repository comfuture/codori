<script setup lang="ts">
import { useRoute } from '#imports'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useProjects } from '../composables/useProjects'
import {
  createServiceUpdateCompletionMonitor,
  reloadPage
} from '../utils/service-update-completion'
import { DEFAULT_SETTINGS_ROUTE } from '~~/shared/settings'

const route = useRoute()
const sidebarCollapsed = ref(false)
const commandPaletteOpen = ref(false)
const {
  serviceUpdate,
  serviceUpdatePending,
  refreshServiceUpdate,
  triggerServiceUpdate
} = useProjects()
const serviceUpdateConfirmOpen = ref(false)

const SERVICE_UPDATE_POLL_INTERVAL_MS = 15 * 60 * 1000
let serviceUpdateTimer: ReturnType<typeof setInterval> | null = null
const serviceUpdateCompletionMonitor = createServiceUpdateCompletionMonitor({
  refreshStatus: refreshServiceUpdate,
  reload: reloadPage
})

const showServiceUpdateButton = computed(() =>
  serviceUpdate.value.enabled && (serviceUpdate.value.updateAvailable || serviceUpdate.value.updating)
)

const serviceUpdateBusy = computed(() =>
  serviceUpdatePending.value || serviceUpdate.value.updating
)

const serviceUpdateTooltip = computed(() => {
  if (!serviceUpdate.value.latestVersion || !serviceUpdate.value.installedVersion) {
    return serviceUpdate.value.updating ? 'Applying the latest server package update.' : 'Install the latest @codori/server package.'
  }

  return serviceUpdate.value.updating
    ? `Updating @codori/server ${serviceUpdate.value.installedVersion} -> ${serviceUpdate.value.latestVersion}`
    : `Update @codori/server ${serviceUpdate.value.installedVersion} -> ${serviceUpdate.value.latestVersion}`
})

const serviceUpdateConfirmDescription = computed(() => {
  if (!serviceUpdate.value.installedVersion || !serviceUpdate.value.latestVersion) {
    return 'A newer @codori/server package is available.'
  }

  return `@codori/server ${serviceUpdate.value.latestVersion} is available. This service is running ${serviceUpdate.value.installedVersion}.`
})

// An update found mid-session only enables this button. Restarting the service
// interrupts running work, so it always waits for an explicit confirmation.
const handleServiceUpdate = () => {
  if (serviceUpdate.value.updating) {
    return
  }
  serviceUpdateConfirmOpen.value = true
}

const confirmServiceUpdate = async () => {
  serviceUpdateConfirmOpen.value = false
  // Start watching before the POST: the detached updater deliberately shuts
  // this server down shortly after its response is flushed.
  serviceUpdateCompletionMonitor.start(serviceUpdate.value.latestVersion)
  const status = await triggerServiceUpdate()
  if (!status?.updating) {
    serviceUpdateCompletionMonitor.stop()
  }
}

onMounted(() => {
  void refreshServiceUpdate()
  serviceUpdateTimer = setInterval(() => {
    void refreshServiceUpdate()
  }, SERVICE_UPDATE_POLL_INTERVAL_MS)
})

onBeforeUnmount(() => {
  serviceUpdateCompletionMonitor.stop()
  if (serviceUpdateTimer) {
    clearInterval(serviceUpdateTimer)
    serviceUpdateTimer = null
  }
})

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
    class="app-shell-height min-h-0 overflow-hidden"
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
          <NuxtLink
            to="/"
            data-testid="sidebar-home-link"
            aria-label="Go to the Codori home screen"
            class="flex min-w-0 items-center gap-3 rounded-xl outline-none transition hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-default"
            :class="collapsed ? '' : 'flex-1'"
          >
            <span class="flex size-9 shrink-0 items-center justify-center">
              <img
                src="/icons/codori-192.png"
                alt=""
                data-testid="sidebar-brand-icon"
                class="size-9 rounded-xl"
              >
            </span>
            <span
              v-if="!collapsed"
              class="min-w-0"
            >
              <span class="block truncate text-sm font-semibold">
                Codori
              </span>
            </span>
            <span
              v-else
              class="sr-only"
            >
              <span>
                Codori
              </span>
            </span>
          </NuxtLink>
        </div>
      </template>

      <template #default="{ collapsed }">
        <ProjectSidebar
          :collapsed="collapsed"
          @open-command-palette="commandPaletteOpen = true"
        />
      </template>

      <template #footer="{ collapsed }">
        <div class="flex w-full items-center gap-2">
          <UTooltip text="Settings">
            <UButton
              color="neutral"
              variant="ghost"
              size="sm"
              icon="i-lucide-settings"
              :label="collapsed ? undefined : 'Settings'"
              aria-label="Open settings"
              :to="settingsRoute"
              :class="collapsed ? 'justify-center' : 'min-w-0 flex-1 justify-start'"
            />
          </UTooltip>
          <UTooltip
            v-if="showServiceUpdateButton"
            :text="serviceUpdateTooltip"
          >
            <UButton
              data-testid="service-update-button"
              color="primary"
              variant="solid"
              size="xs"
              :square="collapsed"
              :disabled="serviceUpdateBusy"
              aria-label="Update Codori"
              class="shrink-0 rounded-full"
              @click="handleServiceUpdate"
            >
              <UIcon
                :name="serviceUpdateBusy ? 'i-lucide-loader-circle' : 'i-lucide-download'"
                class="size-4 shrink-0"
                :class="serviceUpdateBusy ? 'animate-spin motion-reduce:animate-none' : ''"
              />
              <span
                v-if="!collapsed"
                class="hidden sm:inline"
              >
                Update
              </span>
            </UButton>
          </UTooltip>
          <UDashboardSidebarCollapse
            class="relative z-20 ms-auto shrink-0"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <GlobalCommandPalette v-model:open="commandPaletteOpen" />

    <UModal
      v-model:open="serviceUpdateConfirmOpen"
      title="Restart Codori to update?"
    >
      <template #body>
        <p class="text-sm leading-6 text-muted">
          {{ serviceUpdateConfirmDescription }}
        </p>
        <p class="mt-3 text-sm leading-6 text-muted">
          The registered service restarts to apply the update. Running work is interrupted, and
          this page reconnects once the new bundle is serving.
        </p>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            label="Not now"
            @click="serviceUpdateConfirmOpen = false"
          />
          <UButton
            color="primary"
            label="Update and restart"
            :loading="serviceUpdatePending"
            @click="confirmServiceUpdate"
          />
        </div>
      </template>
    </UModal>

    <slot />
  </UDashboardGroup>
</template>

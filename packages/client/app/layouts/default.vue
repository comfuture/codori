<script setup lang="ts">
import { computed, ref } from 'vue'

const sidebarCollapsed = ref(false)

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
</script>

<template>
  <UDashboardGroup
    class="min-h-screen"
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
          <div v-if="!collapsed">
            <div class="text-sm font-semibold">
              Codori
            </div>
            <div class="text-xs text-muted">
              Codex project control
            </div>
          </div>
        </div>
      </template>

      <template #default="{ collapsed }">
        <ProjectSidebar :collapsed="collapsed" />
      </template>

      <template #footer>
        <div class="flex items-center justify-between gap-2">
          <span
            v-if="!sidebarCollapsed"
            class="truncate text-xs text-muted"
          >
            Dashboard
          </span>
          <UDashboardSidebarCollapse
            class="relative z-20 -me-4 shrink-0"
          />
        </div>
      </template>
    </UDashboardSidebar>

    <NuxtPage />
  </UDashboardGroup>
</template>

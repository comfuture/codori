<script setup lang="ts">
import { useRoute } from '#imports'
import type { NavigationMenuItem } from '@nuxt/ui'
import { computed } from 'vue'
import {
  resolveSettingsReturnTo,
  SETTINGS_SECTIONS
} from '~~/shared/settings'

const route = useRoute()
const returnTo = computed(() => resolveSettingsReturnTo(route.query.returnTo))
const sectionItems = computed<NavigationMenuItem[]>(() =>
  SETTINGS_SECTIONS.map(section => ({
    label: section.label,
    icon: section.icon,
    active: route.path === section.path,
    to: {
      path: section.path,
      query: {
        returnTo: returnTo.value
      }
    }
  }))
)
</script>

<template>
  <div class="app-shell-height flex min-h-0 bg-default text-default">
    <aside class="hidden w-64 shrink-0 flex-col border-e border-default bg-elevated/20 px-4 py-5 md:flex">
      <UButton
        :to="returnTo"
        color="neutral"
        variant="ghost"
        icon="i-lucide-arrow-left"
        label="Back to app"
        class="mb-7 justify-start"
      />

      <div class="px-2">
        <p class="text-xs font-medium uppercase tracking-[0.16em] text-muted">
          Codori
        </p>
        <h1 class="mt-1 text-xl font-semibold text-highlighted">
          Settings
        </h1>
      </div>

      <UNavigationMenu
        :items="sectionItems"
        orientation="vertical"
        highlight
        class="mt-6 w-full"
      />
    </aside>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <header class="shrink-0 border-b border-default bg-default/95 px-4 py-3 backdrop-blur md:hidden">
        <div class="flex items-center gap-3">
          <UButton
            :to="returnTo"
            color="neutral"
            variant="ghost"
            icon="i-lucide-arrow-left"
            square
            aria-label="Back to app"
          />
          <div class="min-w-0">
            <p class="text-xs text-muted">
              Codori
            </p>
            <h1 class="truncate text-base font-semibold text-highlighted">
              Settings
            </h1>
          </div>
        </div>

        <div class="mt-3 overflow-x-auto pb-1">
          <UNavigationMenu
            :items="sectionItems"
            highlight
            class="min-w-max"
          />
        </div>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto px-5 pb-32 pt-8 sm:px-8 md:px-12 md:py-12">
        <div class="mx-auto w-full max-w-3xl">
          <slot />
        </div>
      </main>
    </div>
  </div>
</template>

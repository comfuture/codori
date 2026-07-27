<script setup lang="ts">
import { definePageMeta, navigateTo } from '#imports'
import type { RouteLocationNormalized } from 'vue-router'
import { DEFAULT_SETTINGS_ROUTE } from '~~/shared/settings'

definePageMeta({
  layout: 'settings',
  middleware: (to: RouteLocationNormalized) => navigateTo({
    path: DEFAULT_SETTINGS_ROUTE,
    query: to.query
  }, {
    replace: true
  })
})
</script>

<template>
  <div aria-live="polite">
    Opening notification settings…
  </div>
</template>

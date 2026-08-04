<script setup lang="ts">
import { definePageMeta } from '#imports'

definePageMeta({
  layout: 'settings'
})
</script>

<template>
  <section>
    <header class="border-b border-default pb-6">
      <h2 class="text-2xl font-semibold tracking-tight text-highlighted">
        General
      </h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Choose which project directory Codori serves, review what a registered service reuses on
        startup, and pick how the interface looks.
      </p>
    </header>

    <ProjectRootSettings />
    <AppearanceSettings />
  </section>
</template>

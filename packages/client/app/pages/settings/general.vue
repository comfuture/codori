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
        Manage appearance for this Codori server. Workspace folders are owned by Codex app-server
        projects and are managed from the dashboard.
      </p>
    </header>

    <AppearanceSettings />
  </section>
</template>

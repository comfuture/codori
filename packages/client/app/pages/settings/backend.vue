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
        Backend
      </h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Inspect the app-server backend Codori selected for this browser session.
      </p>
    </header>

    <RuntimeBackendSettings />
  </section>
</template>

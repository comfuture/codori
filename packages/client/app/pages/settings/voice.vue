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
        Voice
      </h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Choose the voice Codori will request for your next realtime conversation.
      </p>
    </header>

    <VoiceSettings />
  </section>
</template>

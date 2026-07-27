<script setup lang="ts">
definePageMeta({
  layout: 'settings'
})
</script>

<template>
  <section>
    <header class="border-b border-default pb-6">
      <h2 class="text-2xl font-semibold tracking-tight text-highlighted">
        Notifications
      </h2>
      <p class="mt-2 max-w-2xl text-sm leading-6 text-muted">
        Choose whether Codori can notify you when work finishes in a background tab.
      </p>
    </header>

    <NotificationSettings />
  </section>
</template>

<script setup lang="ts">
const title = 'Codori'
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-default">
    <UCard class="w-full max-w-lg">
      <template #header>
        <div class="space-y-1">
          <h1 class="text-2xl font-semibold">
            {{ title }}
          </h1>
          <p class="text-sm text-muted">
            Codori workspace is initializing.
          </p>
        </div>
      </template>

      <p class="text-sm text-muted">
        The project dashboard, server controls, and Codex chat integration will be added in the next commits.
      </p>
    </UCard>
  </main>
</template>


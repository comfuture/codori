<script setup lang="ts">
// The color-mode preference is client state owned by `@nuxtjs/color-mode`, which
// `@nuxt/ui` already installs and persists in `localStorage`. `UColorModeSelect`
// is the only built-in variant that keeps `system` alongside `light` and `dark`,
// so following the OS appearance stays possible.
</script>

<template>
  <div class="divide-y divide-default">
    <div class="flex flex-col gap-5 py-6 sm:flex-row sm:items-start sm:justify-between">
      <div class="max-w-xl">
        <h3
          id="appearance-color-mode-label"
          class="text-sm font-medium text-highlighted"
        >
          Color mode
        </h3>
        <p
          id="appearance-color-mode-description"
          class="mt-2 text-sm leading-6 text-muted"
        >
          Choose light or dark, or follow your system appearance. The choice is stored in this
          browser and applies immediately.
        </p>
      </div>

      <UColorModeSelect
        class="w-full sm:w-48"
        aria-labelledby="appearance-color-mode-label"
        aria-describedby="appearance-color-mode-description"
      />
    </div>
  </div>
</template>

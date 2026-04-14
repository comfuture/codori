<script setup lang="ts">
import { computed } from 'vue'
import type { PendingMcpElicitationUrl } from '../../../shared/pending-user-request'

const props = defineProps<{
  request: PendingMcpElicitationUrl
}>()

const emit = defineEmits<{
  accept: []
  decline: []
  cancel: []
}>()

const urlHostname = computed(() => {
  try {
    return new URL(props.request.url).hostname
  } catch {
    return props.request.url
  }
})

const openUrl = () => {
  if (typeof window !== 'undefined') {
    window.open(props.request.url, '_blank', 'noopener,noreferrer')
  }

  emit('accept')
}
</script>

<template>
  <div class="space-y-4">
    <section class="rounded-3xl border border-default bg-elevated/30 p-4">
      <p class="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
        External action
      </p>
      <h3 class="mt-2 text-sm font-semibold text-highlighted">
        Open {{ urlHostname }}
      </h3>
      <p class="mt-2 text-sm leading-6 text-muted">
        {{ request.message ?? 'Codex needs you to complete a step in the browser before it can continue.' }}
      </p>

      <div class="mt-4 rounded-2xl border border-default bg-default px-3 py-2 text-sm text-default">
        {{ request.url }}
      </div>
    </section>

    <div class="flex flex-wrap items-center justify-end gap-2">
      <button
        type="button"
        class="rounded-full border border-default px-4 py-2 text-sm font-medium text-default transition hover:border-error/40 hover:text-error"
        @click="emit('decline')"
      >
        Decline
      </button>
      <button
        type="button"
        class="rounded-full border border-default px-4 py-2 text-sm font-medium text-default transition hover:border-default/80 hover:text-highlighted"
        @click="emit('cancel')"
      >
        Cancel
      </button>
      <button
        type="button"
        class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-inverted transition"
        @click="openUrl"
      >
        Open link
      </button>
    </div>
  </div>
</template>

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

const safeUrl = computed(() => {
  try {
    const parsed = new URL(props.request.url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString()
    }

    return null
  } catch {
    return null
  }
})

const openUrl = () => {
  if (!safeUrl.value) {
    emit('cancel')
    return
  }

  if (typeof window !== 'undefined') {
    window.open(safeUrl.value, '_blank', 'noopener,noreferrer')
  }

  emit('accept')
}
</script>

<template>
  <div class="space-y-3">
    <section class="rounded-lg border border-default/70 bg-elevated/20 p-3">
      <p class="text-[11px] font-semibold text-primary">
        External action
      </p>
      <h3 class="mt-1.5 text-sm font-semibold text-highlighted">
        Open {{ urlHostname }}
      </h3>
      <p class="mt-1.5 text-sm leading-5 text-muted">
        {{ request.message ?? 'Codex needs you to complete a step in the browser before it can continue.' }}
      </p>

      <div class="mt-3 rounded-lg border border-default/70 bg-elevated px-3 py-2 text-sm text-default">
        {{ request.url }}
      </div>
    </section>

    <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
      <UButton
        type="button"
        color="error"
        variant="ghost"
        size="sm"
        class="rounded-lg"
        @click="emit('decline')"
      >
        Decline
      </UButton>
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="sm"
        class="rounded-lg"
        @click="emit('cancel')"
      >
        Cancel
      </UButton>
      <UButton
        type="button"
        color="primary"
        size="sm"
        class="rounded-lg"
        @click="openUrl"
      >
        Open link
      </UButton>
    </div>
  </div>
</template>

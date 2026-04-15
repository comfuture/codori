<script setup lang="ts">
import { computed } from 'vue'
import { EVENT_PART, type ThreadEventData } from '~~/shared/codex-chat'

const props = defineProps<{
  part?: {
    type: string
    data: ThreadEventData
  } | null
}>()

const eventData = computed(() =>
  props.part?.type === EVENT_PART ? props.part.data : null
)

const shouldRenderEvent = computed(() => {
  const event = eventData.value
  if (!event) {
    return false
  }

  return (
    event.kind === 'turn.failed'
    || event.kind === 'stream.error'
    || event.kind === 'review.started'
    || event.kind === 'review.completed'
  )
})

const title = computed(() => {
  switch (eventData.value?.kind) {
    case 'review.started':
      return 'Review started'
    case 'review.completed':
      return 'Review completed'
    case 'turn.failed':
      return 'Turn failed'
    case 'stream.error':
      return 'Stream error'
    default:
      return 'Event'
  }
})
const color = computed(() => {
  switch (eventData.value?.kind) {
    case 'review.completed':
      return 'success'
    case 'review.started':
      return 'primary'
    default:
      return 'error'
  }
})

const icon = computed(() => {
  switch (eventData.value?.kind) {
    case 'review.completed':
      return 'i-lucide-badge-check'
    case 'review.started':
      return 'i-lucide-search-check'
    default:
      return 'i-lucide-circle-alert'
  }
})
</script>

<template>
  <UAlert
    v-if="shouldRenderEvent"
    :color="color"
    variant="soft"
    :icon="icon"
    :title="title"
  >
    <template #description>
      <span class="text-sm">
        {{
          eventData?.kind === 'review.started'
            ? eventData.summary ?? 'Codex is reviewing the selected diff.'
            : eventData?.kind === 'review.completed'
              ? 'The review turn finished.'
              : eventData?.kind === 'turn.failed'
                ? eventData.error?.message ?? 'The turn failed.'
                : eventData?.kind === 'stream.error'
                  ? eventData.message
                  : ''
        }}
      </span>
    </template>
  </UAlert>
</template>

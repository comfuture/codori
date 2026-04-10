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

  return event.kind === 'turn.failed' || event.kind === 'stream.error'
})

const title = computed(() => {
  switch (eventData.value?.kind) {
    case 'turn.failed':
      return 'Turn failed'
    case 'stream.error':
      return 'Stream error'
    default:
      return 'Event'
  }
})
</script>

<template>
  <UAlert
    v-if="shouldRenderEvent"
    color="error"
    variant="soft"
    icon="i-lucide-circle-alert"
    :title="title"
  >
    <template #description>
      <span class="text-sm">
        {{
          eventData?.kind === 'turn.failed'
            ? eventData.error?.message ?? 'The turn failed.'
            : eventData?.kind === 'stream.error'
              ? eventData.message
              : ''
        }}
      </span>
    </template>
  </UAlert>
</template>

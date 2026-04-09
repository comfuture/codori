<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  part?: {
    type: 'reasoning'
    summary: string[]
    content: string[]
    state?: 'done' | 'streaming'
  } | null
}>()

const reasoningText = computed(() =>
  [...(props.part?.summary ?? []), ...(props.part?.content ?? [])]
    .join('\n\n')
    .trim()
)

const isStreaming = computed(() => props.part?.state === 'streaming')
</script>

<template>
  <UChatReasoning
    icon="i-lucide-brain"
    :text="reasoningText"
    :streaming="isStreaming"
    :default-open="isStreaming"
    :auto-close-delay="600"
  />
</template>

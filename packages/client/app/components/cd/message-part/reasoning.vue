<script setup lang="ts">
import { Comark } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import { computed } from 'vue'

const props = defineProps<{
  part?: {
    type: 'reasoning'
    summary: string[]
    content: string[]
    state?: 'done' | 'streaming'
  } | null
}>()

const plugins = [highlight({ preStyles: false })]

const summaryText = computed(() => {
  const summary = props.part?.summary.join(' ').trim()
  if (summary) {
    return summary
  }

  const content = props.part?.content.join(' ').trim()
  return content || 'Reasoning'
})

const bodyText = computed(() =>
  [...(props.part?.summary ?? []), ...(props.part?.content ?? [])]
    .join('\n\n')
    .trim()
)

const isStreaming = computed(() => props.part?.state === 'streaming')
</script>

<template>
  <UChatReasoning
    :text="summaryText"
    icon="i-lucide-brain-circuit"
    :streaming="isStreaming"
    :default-open="isStreaming"
    :auto-close-delay="600"
    :ui="{
      root: 'rounded-2xl border border-default/70 bg-elevated/30',
      trigger: 'px-4 py-3',
      label: 'text-sm text-toned',
      body: 'px-4 py-4 border-t border-default/70'
    }"
  >
    <Suspense>
      <Comark
        class="cd-markdown"
        :markdown="bodyText"
        :streaming="isStreaming"
        :plugins="plugins"
        caret
      />
    </Suspense>
  </UChatReasoning>
</template>

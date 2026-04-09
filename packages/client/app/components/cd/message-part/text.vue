<script setup lang="ts">
import { Comark } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import { computed } from 'vue'

const props = defineProps<{
  role?: 'user' | 'assistant' | 'system'
  part?: {
    type: 'text'
    text: string
    state?: 'done' | 'streaming'
  } | null
}>()

const plugins = [highlight({ preStyles: false })]
const isStreaming = computed(() => props.part?.state === 'streaming')
</script>

<template>
  <p
    v-if="role === 'user'"
    class="whitespace-pre-wrap text-[15px] leading-7 text-highlighted"
  >
    {{ part?.text ?? '' }}
  </p>
  <Suspense v-else>
    <Comark
      class="cd-markdown"
      :markdown="part?.text ?? ''"
      :streaming="isStreaming"
      :plugins="plugins"
      caret
    />
  </Suspense>
</template>

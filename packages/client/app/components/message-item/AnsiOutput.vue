<script setup lang="ts">
import { computed } from 'vue'
import { parseAnsiOutput } from '../../utils/ansi-output'

const props = defineProps<{
  text: string
}>()

const segments = computed(() => parseAnsiOutput(props.text))
</script>

<template>
  <pre
    data-ansi-output
    class="overflow-x-auto rounded-xl border border-default/70 bg-elevated/40 px-3 py-3 text-xs leading-6 text-toned"
  ><span
    v-for="(segment, index) in segments"
    :key="index"
    data-ansi-output-segment
    :style="segment.style"
  >{{ segment.text }}</span></pre>
</template>

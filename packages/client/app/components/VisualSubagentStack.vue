<script setup lang="ts">
import { computed } from 'vue'
import type { VisualSubagentPanel } from '~~/shared/codex-chat'
import { resolveSubagentAccent } from '~~/shared/subagent-panels'

const props = defineProps<{
  agents: VisualSubagentPanel[]
}>()

const emit = defineEmits<{
  expand: [threadId: string]
}>()

const paneSize = computed(() => {
  if (!props.agents.length) {
    return 100
  }

  return 100 / props.agents.length
})
</script>

<template>
  <div class="flex h-full min-h-0 flex-col divide-y divide-default">
    <SubagentTranscriptPanel
      v-for="(agent, index) in agents"
      :key="agent.threadId"
      :agent="agent"
      :accent="resolveSubagentAccent(index)"
      show-expand-button
      class="min-h-0 flex-1"
      :style="{ flexBasis: `${paneSize}%` }"
      @expand="emit('expand', agent.threadId)"
    />
  </div>
</template>

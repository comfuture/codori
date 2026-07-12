<script setup lang="ts">
import { computed } from 'vue'
import { useWorkspaceTerminalSurface } from '../composables/useWorkspaceTerminalSurface'

const props = defineProps<{
  workspace: { kind: 'project' | 'chat', id: string }
}>()

const workspace = computed(() => props.workspace)
const { open, toggle } = useWorkspaceTerminalSurface(workspace)
const label = computed(() => open.value ? 'Hide workspace terminal' : 'Open workspace terminal')
</script>

<template>
  <UTooltip :text="label">
    <UButton
      type="button"
      color="neutral"
      :variant="open ? 'soft' : 'outline'"
      size="sm"
      icon="i-lucide-square-terminal"
      square
      :aria-pressed="open"
      :aria-label="label"
      @click="toggle"
    />
  </UTooltip>
</template>

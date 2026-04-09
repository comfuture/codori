<script setup lang="ts">
import { computed, ref, watch } from 'vue'

type ToolStatus = 'inProgress' | 'completed' | 'failed' | string | null | undefined

const props = withDefaults(defineProps<{
  text?: string
  suffix?: string
  icon?: string
  status?: ToolStatus
  variant?: 'inline' | 'card'
  defaultOpen?: boolean
}>(), {
  text: '',
  suffix: undefined,
  icon: undefined,
  status: undefined,
  variant: 'inline',
  defaultOpen: false
})

const open = ref(props.defaultOpen)
const isStreaming = computed(() => props.status === 'inProgress')

watch(() => props.status, (status, previousStatus) => {
  if (status === 'inProgress' || status === 'failed') {
    open.value = true
    return
  }

  if (status === 'completed' && previousStatus === 'inProgress') {
    open.value = false
  }
}, { immediate: true })
</script>

<template>
  <UChatTool
    :text="text"
    :suffix="suffix"
    :icon="icon"
    :streaming="isStreaming"
    :variant="variant"
    :open="open"
    @update:open="open = $event"
  >
    <slot />
  </UChatTool>
</template>

import { computed, ref, watch } from 'vue'

type ToolStatus = 'inProgress' | 'completed' | 'failed' | 'running' | 'streaming' | string | null | undefined

const runningStatuses = new Set(['inProgress', 'running', 'streaming'])

export const useChatToolState = (status: () => ToolStatus, defaultOpen = false) => {
  const open = ref(defaultOpen)
  const isRunning = computed(() => runningStatuses.has(String(status() ?? '')))

  watch(status, (nextStatus, previousStatus) => {
    if (isRunning.value || nextStatus === 'failed') {
      open.value = true
      return
    }

    if (nextStatus === 'completed' && runningStatuses.has(String(previousStatus ?? ''))) {
      open.value = false
    }
  }, { immediate: true })

  return {
    open,
    isLoading: computed(() => isRunning.value),
    isStreaming: computed(() => isRunning.value)
  }
}

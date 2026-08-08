import { watch, type Ref } from 'vue'
import type { RealtimeCapability } from './useRealtimeConversation'

type RealtimeVoiceCapabilityLifecycleOptions = {
  activeThreadId: Readonly<Ref<string | null>>
  rpcConnectionEpoch: Readonly<Ref<number>>
  contextEpoch: Readonly<Ref<number>>
  activeElsewhere: Readonly<Ref<boolean>>
  capability: Ref<RealtimeCapability>
  cancelPendingRefresh: () => void
  refreshThreadCapability: (threadId: string) => Promise<void>
  refreshDraftCatalog: () => Promise<void>
  beforeContextRefresh?: (threadId: string | null) => void
}

export const useRealtimeVoiceCapabilityLifecycle = (
  options: RealtimeVoiceCapabilityLifecycleOptions
) => {
  const refreshCurrentContext = (threadId: string | null) => {
    options.cancelPendingRefresh()
    options.beforeContextRefresh?.(threadId)
    if (options.activeElsewhere.value) {
      return
    }

    options.capability.value = {
      status: 'checking',
      message: threadId ? 'Checking realtime voice support.' : 'Start voice session'
    }
    if (threadId) {
      void options.refreshThreadCapability(threadId)
    } else {
      void options.refreshDraftCatalog()
    }
  }

  watch([
    options.activeThreadId,
    options.rpcConnectionEpoch,
    options.contextEpoch
  ], ([threadId]) => {
    refreshCurrentContext(threadId)
  }, { immediate: true })

  watch(options.activeElsewhere, (activeElsewhere, wasActiveElsewhere) => {
    options.cancelPendingRefresh()
    if (wasActiveElsewhere && !activeElsewhere) {
      refreshCurrentContext(options.activeThreadId.value)
    }
  })
}

import { useWakeLock, type UseWakeLockReturn } from '@vueuse/core'
import { onScopeDispose, watch, type Ref } from 'vue'
import type { RealtimeSessionState } from './useRealtimeConversation'
import { isRealtimeVoiceCompanionActive } from '../utils/realtime-voice-companion'

export type RealtimeVoiceWakeLock = Pick<
  UseWakeLockReturn,
  'isSupported' | 'isActive' | 'request' | 'release'
>

export const useRealtimeVoiceWakeLock = (
  state: Readonly<Ref<RealtimeSessionState>>,
  createWakeLock: () => RealtimeVoiceWakeLock = useWakeLock
) => {
  const wakeLock = createWakeLock()
  let shouldHoldWakeLock = false
  let wakeLockRequested = false
  let syncOperation = Promise.resolve()

  const releaseWakeLock = async () => {
    try {
      await wakeLock.release()
    } catch {
      // Wake lock support is best-effort and must not interrupt voice.
    }
  }

  const syncWakeLock = async () => {
    if (!shouldHoldWakeLock) {
      if (!wakeLockRequested && !wakeLock.isActive.value) {
        return
      }
      wakeLockRequested = false
      await releaseWakeLock()
      return
    }

    if (!wakeLock.isSupported.value) {
      return
    }

    wakeLockRequested = true
    try {
      await wakeLock.request('screen')
    } catch {
      wakeLockRequested = false
      return
    }

    if (!shouldHoldWakeLock) {
      wakeLockRequested = false
      await releaseWakeLock()
    }
  }

  const queueWakeLockSync = () => {
    syncOperation = syncOperation.then(syncWakeLock, syncWakeLock)
  }

  watch(
    () => isRealtimeVoiceCompanionActive(state.value),
    shouldHold => {
      shouldHoldWakeLock = shouldHold
      queueWakeLockSync()
    },
    { immediate: true }
  )

  onScopeDispose(() => {
    shouldHoldWakeLock = false
    queueWakeLockSync()
  })

  return {
    isSupported: wakeLock.isSupported,
    isActive: wakeLock.isActive
  }
}

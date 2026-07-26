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
  let syncGeneration = 0
  let wakeLockRequested = false

  const releaseWakeLock = async () => {
    try {
      await wakeLock.release()
    } catch {
      // Wake lock support is best-effort and must not interrupt voice.
    }
  }

  const syncWakeLock = async (shouldHold: boolean) => {
    const candidateGeneration = ++syncGeneration
    if (!shouldHold) {
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
      if (candidateGeneration === syncGeneration) {
        wakeLockRequested = false
      }
      return
    }

    if (
      candidateGeneration !== syncGeneration
      || !isRealtimeVoiceCompanionActive(state.value)
    ) {
      wakeLockRequested = false
      await releaseWakeLock()
    }
  }

  watch(
    () => isRealtimeVoiceCompanionActive(state.value),
    shouldHold => void syncWakeLock(shouldHold),
    { immediate: true }
  )

  onScopeDispose(() => {
    syncGeneration += 1
    if (wakeLockRequested || wakeLock.isActive.value) {
      wakeLockRequested = false
      void releaseWakeLock()
    }
  })

  return {
    isSupported: wakeLock.isSupported,
    isActive: wakeLock.isActive
  }
}

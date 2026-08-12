import { useWakeLock, type UseWakeLockReturn } from '@vueuse/core'
import { onScopeDispose, watch, type Ref } from 'vue'

export type ActiveTurnWakeLock = Pick<
  UseWakeLockReturn,
  'isSupported' | 'isActive' | 'request' | 'release'
>

export const useActiveTurnWakeLock = (
  hasActiveTurn: Readonly<Ref<boolean>>,
  createWakeLock: () => ActiveTurnWakeLock = useWakeLock
) => {
  const wakeLock = createWakeLock()
  let shouldHoldWakeLock = false
  let wakeLockRequested = false
  let syncOperation = Promise.resolve()

  const releaseWakeLock = async () => {
    try {
      await wakeLock.release()
    } catch {
      // A normal turn must continue even when the browser denies wake-lock cleanup.
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

  watch(hasActiveTurn, shouldHold => {
    shouldHoldWakeLock = shouldHold
    queueWakeLockSync()
  }, { immediate: true })

  onScopeDispose(() => {
    shouldHoldWakeLock = false
    queueWakeLockSync()
  })

  return {
    isSupported: wakeLock.isSupported,
    isActive: wakeLock.isActive
  }
}

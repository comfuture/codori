import { computed, effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useRealtimeVoiceWakeLock,
  type RealtimeVoiceWakeLock
} from '../app/composables/useRealtimeVoiceWakeLock'
import type { RealtimeSessionState } from '../app/composables/useRealtimeConversation'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

const createFixture = (input?: {
  active?: boolean
  supported?: boolean
  request?: () => Promise<void>
}) => {
  const active = ref(input?.active ?? false)
  const request = vi.fn(input?.request ?? (async () => {
    active.value = true
  }))
  const release = vi.fn(async () => {
    active.value = false
  })
  const wakeLock: RealtimeVoiceWakeLock = {
    isSupported: computed(() => input?.supported ?? true),
    isActive: computed(() => active.value),
    request,
    release
  }

  return {
    active,
    request,
    release,
    createWakeLock: () => wakeLock
  }
}

describe('realtime voice wake lock', () => {
  it('holds the screen awake only while the voice lifecycle is active', async () => {
    const state = ref<RealtimeSessionState>('idle')
    const fixture = createFixture()
    const scope = effectScope()
    scope.run(() => useRealtimeVoiceWakeLock(state, fixture.createWakeLock))

    expect(fixture.request).not.toHaveBeenCalled()
    state.value = 'starting'
    await nextTick()
    await vi.waitFor(() => {
      expect(fixture.request).toHaveBeenCalledWith('screen')
    })

    state.value = 'connected'
    await nextTick()
    expect(fixture.request).toHaveBeenCalledTimes(1)

    state.value = 'closed'
    await nextTick()
    await vi.waitFor(() => {
      expect(fixture.release).toHaveBeenCalledTimes(1)
    })

    scope.stop()
  })

  it('does not request unsupported wake locks or surface browser failures', async () => {
    const state = ref<RealtimeSessionState>('connected')
    const unsupported = createFixture({ supported: false })
    const unsupportedScope = effectScope()
    unsupportedScope.run(() =>
      useRealtimeVoiceWakeLock(state, unsupported.createWakeLock)
    )
    await nextTick()
    expect(unsupported.request).not.toHaveBeenCalled()
    unsupportedScope.stop()

    const failing = createFixture({
      request: async () => {
        throw new Error('Wake lock denied')
      }
    })
    const failingScope = effectScope()
    failingScope.run(() => useRealtimeVoiceWakeLock(state, failing.createWakeLock))
    await nextTick()
    await Promise.resolve()
    expect(failing.request).toHaveBeenCalledWith('screen')
    failingScope.stop()
  })

  it('releases a late request after the voice session has already stopped', async () => {
    const state = ref<RealtimeSessionState>('idle')
    const pendingRequest = deferred()
    const fixture = createFixture({
      request: () => pendingRequest.promise
    })
    const scope = effectScope()
    scope.run(() => useRealtimeVoiceWakeLock(state, fixture.createWakeLock))

    state.value = 'starting'
    await nextTick()
    await vi.waitFor(() => {
      expect(fixture.request).toHaveBeenCalledTimes(1)
    })
    state.value = 'closed'
    await nextTick()
    expect(fixture.release).not.toHaveBeenCalled()

    pendingRequest.resolve()
    await pendingRequest.promise
    await vi.waitFor(() => {
      expect(fixture.release).toHaveBeenCalledTimes(1)
    })

    scope.stop()
  })

  it('serializes stop and restart behind an older pending request', async () => {
    const state = ref<RealtimeSessionState>('idle')
    const firstRequest = deferred()
    const fixture = createFixture({
      request: () => firstRequest.promise
    })
    const scope = effectScope()
    scope.run(() => useRealtimeVoiceWakeLock(state, fixture.createWakeLock))

    state.value = 'starting'
    await nextTick()
    await vi.waitFor(() => {
      expect(fixture.request).toHaveBeenCalledTimes(1)
    })
    state.value = 'closed'
    await nextTick()
    state.value = 'starting'
    await nextTick()

    expect(fixture.request).toHaveBeenCalledTimes(1)
    expect(fixture.release).not.toHaveBeenCalled()

    fixture.active.value = true
    firstRequest.resolve()
    await firstRequest.promise
    await vi.waitFor(() => {
      expect(fixture.active.value).toBe(true)
    })
    expect(fixture.request).toHaveBeenCalledTimes(1)
    expect(fixture.release).not.toHaveBeenCalled()

    state.value = 'closed'
    await nextTick()
    await vi.waitFor(() => {
      expect(fixture.release).toHaveBeenCalledTimes(1)
    })

    scope.stop()
  })
})

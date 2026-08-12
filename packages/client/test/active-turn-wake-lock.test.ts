import { computed, effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  useActiveTurnWakeLock,
  type ActiveTurnWakeLock
} from '../app/composables/useActiveTurnWakeLock'
import { useChatSession, useHasActiveChatTurn } from '../app/composables/useChatSession'

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
  const wakeLock: ActiveTurnWakeLock = {
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

let sessionCounter = 0
const createSession = () => useChatSession(`wake-lock-test:${sessionCounter += 1}`)

describe('active turn wake lock', () => {
  it('aggregates submitted and streaming turns across normal sessions', async () => {
    const first = createSession()
    const second = createSession()
    const hasActiveTurn = useHasActiveChatTurn()

    expect(hasActiveTurn.value).toBe(false)
    first.status.value = 'submitted'
    await nextTick()
    expect(hasActiveTurn.value).toBe(true)

    first.status.value = 'streaming'
    second.status.value = 'submitted'
    await nextTick()
    expect(hasActiveTurn.value).toBe(true)

    first.status.value = 'ready'
    await nextTick()
    expect(hasActiveTurn.value).toBe(true)

    second.status.value = 'error'
    await nextTick()
    expect(hasActiveTurn.value).toBe(false)
  })

  it('holds one lock until the final active turn ends', async () => {
    const hasActiveTurn = ref(false)
    const fixture = createFixture()
    const scope = effectScope()
    scope.run(() => useActiveTurnWakeLock(hasActiveTurn, fixture.createWakeLock))

    hasActiveTurn.value = true
    await nextTick()
    await vi.waitFor(() => {
      expect(fixture.request).toHaveBeenCalledWith('screen')
    })

    hasActiveTurn.value = true
    await nextTick()
    expect(fixture.request).toHaveBeenCalledTimes(1)

    hasActiveTurn.value = false
    await nextTick()
    await vi.waitFor(() => {
      expect(fixture.release).toHaveBeenCalledTimes(1)
    })

    scope.stop()
  })

  it('does not request unsupported locks or surface browser failures', async () => {
    const hasActiveTurn = ref(true)
    const unsupported = createFixture({ supported: false })
    const unsupportedScope = effectScope()
    unsupportedScope.run(() =>
      useActiveTurnWakeLock(hasActiveTurn, unsupported.createWakeLock)
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
    failingScope.run(() => useActiveTurnWakeLock(hasActiveTurn, failing.createWakeLock))
    await nextTick()
    await vi.waitFor(() => {
      expect(failing.request).toHaveBeenCalledWith('screen')
    })
    failingScope.stop()
  })

  it('releases a late request after the final turn already ended', async () => {
    const hasActiveTurn = ref(false)
    const pendingRequest = deferred()
    const fixture = createFixture({ request: () => pendingRequest.promise })
    const scope = effectScope()
    scope.run(() => useActiveTurnWakeLock(hasActiveTurn, fixture.createWakeLock))

    hasActiveTurn.value = true
    await nextTick()
    await vi.waitFor(() => {
      expect(fixture.request).toHaveBeenCalledTimes(1)
    })
    hasActiveTurn.value = false
    await nextTick()
    expect(fixture.release).not.toHaveBeenCalled()

    pendingRequest.resolve()
    await pendingRequest.promise
    await vi.waitFor(() => {
      expect(fixture.release).toHaveBeenCalledTimes(1)
    })

    scope.stop()
  })

  it('releases an active lock when the app-level scope is disposed', async () => {
    const hasActiveTurn = ref(true)
    const fixture = createFixture()
    const scope = effectScope()
    scope.run(() => useActiveTurnWakeLock(hasActiveTurn, fixture.createWakeLock))
    await vi.waitFor(() => {
      expect(fixture.request).toHaveBeenCalledTimes(1)
    })

    scope.stop()
    await vi.waitFor(() => {
      expect(fixture.release).toHaveBeenCalledTimes(1)
    })
  })
})

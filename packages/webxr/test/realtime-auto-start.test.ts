import { describe, expect, it, vi } from 'vitest'
import { coordinateRealtimeAutoStart } from '../src/realtime-auto-start'

describe('immersive realtime auto start', () => {
  it('waits for both the runtime and the 500ms entry delay', async () => {
    let releaseRuntime!: () => void
    let releaseDelay!: () => void
    const prepare = vi.fn(() => new Promise<void>((resolve) => {
      releaseRuntime = resolve
    }))
    const wait = vi.fn(() => new Promise<void>((resolve) => {
      releaseDelay = resolve
    }))
    const order: string[] = []
    const start = vi.fn(async () => {
      order.push('start')
    })
    const pending = coordinateRealtimeAutoStart({
      prepare,
      wait,
      isCurrent: () => true,
      beforeStart: () => {
        order.push('awaken')
      },
      start,
      onStartError: vi.fn()
    })

    releaseDelay()
    await Promise.resolve()
    expect(start).not.toHaveBeenCalled()
    releaseRuntime()

    await expect(pending).resolves.toBe(true)
    expect(wait).toHaveBeenCalledWith(500)
    expect(order).toEqual(['awaken', 'start'])
  })

  it('does not start after the immersive session is no longer current', async () => {
    const start = vi.fn()
    await expect(coordinateRealtimeAutoStart({
      prepare: async () => {},
      wait: async () => {},
      isCurrent: () => false,
      start,
      onStartError: vi.fn()
    })).resolves.toBe(false)
    expect(start).not.toHaveBeenCalled()
  })

  it('reports voice startup errors without rejecting XR entry', async () => {
    const error = new Error('voice unavailable')
    const onStartError = vi.fn()
    await expect(coordinateRealtimeAutoStart({
      prepare: async () => {},
      wait: async () => {},
      isCurrent: () => true,
      start: async () => {
        throw error
      },
      onStartError
    })).resolves.toBe(false)
    expect(onStartError).toHaveBeenCalledWith(error)
  })
})

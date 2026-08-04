import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceUpdateStatus } from '../shared/codori'
import { createServiceUpdateCompletionMonitor } from '../app/utils/service-update-completion'

const createStatus = (overrides: Partial<ServiceUpdateStatus> = {}): ServiceUpdateStatus => ({
  enabled: true,
  updateAvailable: true,
  updating: true,
  installedVersion: '0.13.1',
  latestVersion: '0.13.2',
  ...overrides
})

describe('service update completion monitor', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits through restart downtime and reloads only for the expected installed version', async () => {
    vi.useFakeTimers()
    const refreshStatus = vi.fn<() => Promise<ServiceUpdateStatus>>()
      .mockResolvedValueOnce(createStatus())
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(createStatus({
        updating: false,
        installedVersion: '0.13.1'
      }))
      .mockResolvedValueOnce(createStatus({
        updateAvailable: false,
        updating: false,
        installedVersion: '0.13.2'
      }))
    const reload = vi.fn()
    const monitor = createServiceUpdateCompletionMonitor({
      refreshStatus,
      reload,
      intervalMs: 1_000
    })

    expect(monitor.start('0.13.2')).toBe(true)

    await vi.advanceTimersByTimeAsync(3_000)
    expect(reload).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(refreshStatus).toHaveBeenCalledTimes(4)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('does not overlap slow status requests', async () => {
    vi.useFakeTimers()
    let resolveStatus!: (status: ServiceUpdateStatus) => void
    const refreshStatus = vi.fn(() => new Promise<ServiceUpdateStatus>((resolve) => {
      resolveStatus = resolve
    }))
    const reload = vi.fn()
    const monitor = createServiceUpdateCompletionMonitor({
      refreshStatus,
      reload,
      intervalMs: 1_000
    })

    monitor.start('0.13.2')
    await vi.advanceTimersByTimeAsync(5_000)
    expect(refreshStatus).toHaveBeenCalledTimes(1)

    resolveStatus(createStatus({
      updateAvailable: false,
      updating: false,
      installedVersion: '0.13.2'
    }))
    await Promise.resolve()

    expect(reload).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an in-flight watch without reloading', async () => {
    vi.useFakeTimers()
    let resolveStatus!: (status: ServiceUpdateStatus) => void
    const refreshStatus = vi.fn(() => new Promise<ServiceUpdateStatus>((resolve) => {
      resolveStatus = resolve
    }))
    const reload = vi.fn()
    const monitor = createServiceUpdateCompletionMonitor({
      refreshStatus,
      reload,
      intervalMs: 1_000
    })

    monitor.start('0.13.2')
    await vi.advanceTimersByTimeAsync(1_000)
    monitor.stop()
    resolveStatus(createStatus({
      updateAvailable: false,
      updating: false,
      installedVersion: '0.13.2'
    }))
    await Promise.resolve()

    expect(reload).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
})

import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ServiceUpdateStatus } from '../shared/codori'
import {
  comparePackageVersions,
  createServiceUpdateCompletionMonitor
} from '../app/utils/service-update-completion'

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

  it('accepts a server version newer than the originally observed target', async () => {
    vi.useFakeTimers()
    const refreshStatus = vi.fn(async () => createStatus({
      updateAvailable: false,
      updating: false,
      installedVersion: '0.13.3',
      latestVersion: '0.13.3'
    }))
    const reload = vi.fn()
    const monitor = createServiceUpdateCompletionMonitor({
      refreshStatus,
      reload,
      intervalMs: 1_000
    })

    monitor.start('0.13.2')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('uses SemVer precedence when stable latest replaces a prerelease target', async () => {
    vi.useFakeTimers()
    const refreshStatus = vi.fn(async () => createStatus({
      updateAvailable: false,
      updating: false,
      installedVersion: '1.0.0',
      latestVersion: '1.0.0'
    }))
    const reload = vi.fn()
    const monitor = createServiceUpdateCompletionMonitor({
      refreshStatus,
      reload,
      intervalMs: 1_000
    })

    monitor.start('1.0.0-beta')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(reload).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('orders SemVer prerelease identifiers and ignores build metadata', () => {
    const versions = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0'
    ]

    for (let index = 1; index < versions.length; index += 1) {
      expect(comparePackageVersions(versions[index]!, versions[index - 1]!)).toBeGreaterThan(0)
    }
    expect(comparePackageVersions('1.0.0+build.2', '1.0.0+build.1')).toBe(0)
  })

  it('stops polling after the bounded completion window', async () => {
    vi.useFakeTimers()
    const refreshStatus = vi.fn(async () => createStatus())
    const reload = vi.fn()
    const monitor = createServiceUpdateCompletionMonitor({
      refreshStatus,
      reload,
      intervalMs: 1_000,
      timeoutMs: 3_500
    })

    monitor.start('0.13.2')
    await vi.advanceTimersByTimeAsync(4_000)

    expect(refreshStatus).toHaveBeenCalledTimes(3)
    expect(reload).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('stops without reloading when the durable update rolls back', async () => {
    vi.useFakeTimers()
    const refreshStatus = vi.fn(async () => createStatus({
      updating: false,
      installedVersion: '0.13.1',
      phase: 'rolled-back',
      failureReason: 'target reported the wrong version'
    }))
    const reload = vi.fn()
    const monitor = createServiceUpdateCompletionMonitor({
      refreshStatus,
      reload,
      intervalMs: 1_000
    })

    monitor.start('0.13.2')
    await vi.advanceTimersByTimeAsync(1_000)

    expect(reload).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
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

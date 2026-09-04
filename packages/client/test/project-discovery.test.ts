import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createProjectDiscoveryRunner,
  createProjectDiscoveryRunnerRegistry
} from '../app/utils/project-discovery'

afterEach(() => {
  vi.useRealTimers()
})

describe('project discovery retry runner', () => {
  it('recovers after a transient initial failure', async () => {
    vi.useFakeTimers()
    const discover = vi.fn()
      .mockRejectedValueOnce(new Error('bridge starting'))
      .mockResolvedValueOnce('ready')
    const states: string[] = []
    const runner = createProjectDiscoveryRunner({
      discover,
      isRetryable: () => true,
      retryDelaysMs: [100, 200],
      onState: state => states.push(state.status)
    })

    const result = runner.start()
    await vi.advanceTimersByTimeAsync(100)

    await expect(result).resolves.toBe('ready')
    expect(discover).toHaveBeenCalledTimes(2)
    expect(states).toEqual(['loading', 'retrying', 'loading', 'ready'])
  })

  it('exhausts bounded retries and reports the final failure', async () => {
    vi.useFakeTimers()
    const finalError = new Error('still unavailable')
    const discover = vi.fn().mockRejectedValue(finalError)
    const states: Array<{ status: string, attempt: number }> = []
    const runner = createProjectDiscoveryRunner({
      discover,
      isRetryable: () => true,
      retryDelaysMs: [100, 200, 400],
      onState: state => states.push({ status: state.status, attempt: state.attempt })
    })

    const result = runner.start()
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBeUndefined()
    expect(discover).toHaveBeenCalledTimes(4)
    expect(states.at(-1)).toEqual({ status: 'error', attempt: 4 })
  })

  it('does not overlap concurrent starts or retry permanent failures', async () => {
    const discover = vi.fn().mockRejectedValue(new Error('unsupported'))
    const states: string[] = []
    const runner = createProjectDiscoveryRunner({
      discover,
      isRetryable: () => false,
      onState: state => states.push(state.status)
    })

    const first = runner.start()
    const second = runner.start()

    expect(second).toBe(first)
    await expect(first).resolves.toBeUndefined()
    expect(discover).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['loading', 'error'])
  })

  it('joins one active runner across consumers that share project state', async () => {
    const owner = {}
    const registry = createProjectDiscoveryRunnerRegistry<string>()
    let resolveDiscovery!: (value: string) => void
    const discover = vi.fn(() => new Promise<string>((resolve) => {
      resolveDiscovery = resolve
    }))
    const createRunner = () => createProjectDiscoveryRunner({
      discover,
      isRetryable: () => true,
      onState: () => {}
    })

    const sidebarRunner = registry.get(owner, createRunner)
    const pageRunner = registry.get(owner, createRunner)
    const sidebarRefresh = sidebarRunner.start()
    const pageRefresh = pageRunner.start()

    expect(pageRunner).toBe(sidebarRunner)
    expect(pageRefresh).toBe(sidebarRefresh)
    expect(discover).toHaveBeenCalledTimes(1)

    resolveDiscovery('ready')
    await expect(sidebarRefresh).resolves.toBe('ready')
    expect(discover).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending retry and suppresses later state updates', async () => {
    vi.useFakeTimers()
    const discover = vi.fn().mockRejectedValue(new Error('bridge starting'))
    const states: string[] = []
    const runner = createProjectDiscoveryRunner({
      discover,
      isRetryable: () => true,
      retryDelaysMs: [100, 200],
      onState: state => states.push(state.status)
    })

    const result = runner.start()
    await Promise.resolve()
    expect(states).toEqual(['loading', 'retrying'])

    runner.cancel()
    expect(vi.getTimerCount()).toBe(0)
    await vi.runAllTimersAsync()

    await expect(result).resolves.toBeUndefined()
    expect(discover).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['loading', 'retrying'])
  })
})

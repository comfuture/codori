import { describe, expect, it, vi } from 'vitest'
import { terminateProcessTree } from '../src/process-tree.js'

describe('process tree termination', () => {
  it('targets the detached POSIX process group', async () => {
    let alive = true
    const signal = vi.fn(() => {
      alive = false
    })

    await expect(terminateProcessTree(4321, {
      platform: 'linux',
      forceAfterMs: 10,
      pollMs: 1,
      isAlive: () => alive,
      signal
    })).resolves.toBe(true)

    expect(signal).toHaveBeenCalledWith(-4321, 'SIGTERM')
  })

  it('uses Windows tree termination before considering the PID stopped', async () => {
    let alive = true
    const taskkill = vi.fn(async () => {
      alive = false
      return true
    })

    await expect(terminateProcessTree(4321, {
      platform: 'win32',
      forceAfterMs: 10,
      pollMs: 1,
      isAlive: () => alive,
      taskkill
    })).resolves.toBe(true)

    expect(taskkill).toHaveBeenCalledWith(4321, false)
  })
})

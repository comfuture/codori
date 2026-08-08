// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createThreadReactivationRecoveryCoordinator,
  findActiveTurn,
  hydrateThreadView,
  isConstrainedBrowserRequiringDeferredSync,
  isActiveTurnStatus,
  recoverThreadAfterReactivation,
  resumeThreadStreamAfterReactivation,
  resolveThreadReactivationDelay,
  resolveHydratedActiveTurn,
  shouldAttemptThreadReactivationSync
} from '../app/utils/thread-reactivation'
import type { ThreadReadResponse } from '../shared/generated/codex-app-server/v2/ThreadReadResponse'
import type { ThreadResumeResponse } from '../shared/generated/codex-app-server/v2/ThreadResumeResponse'
import type { Thread } from '../shared/generated/codex-app-server/v2/Thread'
import type { Turn } from '../shared/generated/codex-app-server/v2/Turn'

const makeTurn = (id: string, status: Turn['status']): Turn => ({
  id,
  status,
  items: [],
  itemsView: 'full',
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null
})

const makeThreadSnapshot = (
  turns: Turn[],
  status: Thread['status']['type'] = 'active'
): Pick<Thread, 'status' | 'turns'> => ({
  status: status === 'active'
    ? { type: 'active', activeFlags: [] }
    : { type: status },
  turns
})

describe('thread reactivation policy', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('keeps desktop browsers in continuous streaming mode by default', () => {
    expect(isConstrainedBrowserRequiringDeferredSync({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 0
    })).toBe(false)

    expect(isConstrainedBrowserRequiringDeferredSync({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 0
    })).toBe(false)
  })

  it('uses deferred reactivation sync for constrained mobile browsers', () => {
    expect(isConstrainedBrowserRequiringDeferredSync({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5
    })).toBe(true)

    expect(isConstrainedBrowserRequiringDeferredSync({
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5
    })).toBe(true)
  })

  it('recognizes iPadOS Safari desktop-mode user agents as constrained', () => {
    expect(isConstrainedBrowserRequiringDeferredSync({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      platform: 'MacIntel',
      maxTouchPoints: 5
    })).toBe(true)
  })

  it('does not resync desktop streams on ordinary focus or interaction while transport is connected', () => {
    expect(shouldAttemptThreadReactivationSync({
      reason: 'window/focus',
      browserRequiresDeferredSync: false,
      transportConnected: true,
      hadDocumentDeactivation: false
    })).toBe(false)

    expect(shouldAttemptThreadReactivationSync({
      reason: 'window/interaction',
      browserRequiresDeferredSync: false,
      transportConnected: true,
      hadDocumentDeactivation: false
    })).toBe(false)
  })

  it('recovers desktop streams after deactivation even when the transport appears connected', () => {
    expect(shouldAttemptThreadReactivationSync({
      reason: 'window/visible',
      browserRequiresDeferredSync: false,
      transportConnected: true,
      hadDocumentDeactivation: true
    })).toBe(true)

    expect(shouldAttemptThreadReactivationSync({
      reason: 'window/focus',
      browserRequiresDeferredSync: false,
      transportConnected: true,
      hadDocumentDeactivation: true
    })).toBe(true)

    expect(shouldAttemptThreadReactivationSync({
      reason: 'window/interaction',
      browserRequiresDeferredSync: false,
      transportConnected: true,
      hadDocumentDeactivation: true
    })).toBe(false)
  })

  it('keeps desktop recovery available when the transport was dropped', () => {
    expect(shouldAttemptThreadReactivationSync({
      reason: 'window/focus',
      browserRequiresDeferredSync: false,
      transportConnected: false,
      hadDocumentDeactivation: false
    })).toBe(true)
  })

  it('uses deferred sync for constrained browsers only after a deactivation signal', () => {
    expect(shouldAttemptThreadReactivationSync({
      reason: 'window/visible',
      browserRequiresDeferredSync: true,
      transportConnected: true,
      hadDocumentDeactivation: true
    })).toBe(true)

    expect(shouldAttemptThreadReactivationSync({
      reason: 'window/focus',
      browserRequiresDeferredSync: true,
      transportConnected: true,
      hadDocumentDeactivation: false
    })).toBe(false)
  })

  it('uses the longer remaining throttle or deactivation grace as the trailing delay', () => {
    expect(resolveThreadReactivationDelay({
      now: 10_000,
      lastRecoveryAt: 4_000,
      deactivatedAt: 9_800,
      minimumIntervalMs: 8_000,
      inactiveGraceMs: 500
    })).toBe(2_000)

    expect(resolveThreadReactivationDelay({
      now: 20_000,
      lastRecoveryAt: 10_000,
      deactivatedAt: 19_800,
      minimumIntervalMs: 8_000,
      inactiveGraceMs: 500
    })).toBe(300)
  })

  it('coalesces lifecycle bursts into one trailing recovery attempt', async () => {
    vi.useFakeTimers()
    let now = 10_000
    const recover = vi.fn(async () => {})
    const coordinator = createThreadReactivationRecoveryCoordinator({
      now: () => now,
      recover
    })

    coordinator.request('window/pageshow', 500)
    coordinator.request('window/visible', 700)
    coordinator.request('window/focus', 600)

    now += 499
    await vi.advanceTimersByTimeAsync(499)
    expect(recover).not.toHaveBeenCalled()

    now += 1
    await vi.advanceTimersByTimeAsync(1)
    expect(recover).toHaveBeenCalledOnce()
    expect(recover).toHaveBeenCalledWith('window/focus')

    coordinator.dispose()
  })

  it('deduplicates recovery signals while one attempt is in flight', async () => {
    let finishRecovery!: () => void
    const recovery = new Promise<void>((resolve) => {
      finishRecovery = resolve
    })
    const recover = vi.fn(async () => await recovery)
    const coordinator = createThreadReactivationRecoveryCoordinator({ recover })

    const first = coordinator.request('window/pageshow')
    const second = coordinator.request('document/resume')
    await Promise.resolve()

    expect(first).toBe(second)
    expect(recover).toHaveBeenCalledOnce()

    finishRecovery()
    await first
    coordinator.dispose()
  })

  it('resolves active turn state from resume before the read snapshot', () => {
    const readCompletedTurn = makeTurn('turn-read-completed', 'completed')
    const resumeActiveTurn = makeTurn('turn-resume-active', 'inProgress')

    expect(isActiveTurnStatus('inProgress')).toBe(true)
    expect(isActiveTurnStatus('completed')).toBe(false)
    expect(isActiveTurnStatus('running')).toBe(false)
    expect(findActiveTurn({
      turns: [readCompletedTurn, resumeActiveTurn]
    })).toBe(resumeActiveTurn)
    expect(resolveHydratedActiveTurn({
      readThread: makeThreadSnapshot([readCompletedTurn]),
      resumeThread: { turns: [resumeActiveTurn] }
    })).toBe(resumeActiveTurn)
  })

  it('does not revive a resume turn that the read snapshot marks completed', () => {
    const readCompletedTurn = makeTurn('turn-stale-active', 'completed')
    const resumeActiveTurn = makeTurn('turn-stale-active', 'inProgress')

    expect(resolveHydratedActiveTurn({
      readThread: makeThreadSnapshot([readCompletedTurn]),
      resumeThread: { turns: [resumeActiveTurn] }
    })).toBeNull()
  })

  it('ignores resume active turns when the read snapshot is idle', () => {
    const readCompletedTurn = makeTurn('turn-read-completed', 'completed')
    const resumeActiveTurn = makeTurn('turn-resume-active', 'inProgress')

    expect(resolveHydratedActiveTurn({
      readThread: makeThreadSnapshot([readCompletedTurn], 'idle'),
      resumeThread: { turns: [resumeActiveTurn] }
    })).toBeNull()
  })

  it('rehydrates through thread/resume before thread/read after reconnecting', async () => {
    const resumeResponse = { thread: { id: 'thread-1' } } as unknown as ThreadResumeResponse
    const readResponse = { thread: { id: 'thread-1', turns: [] } } as unknown as ThreadReadResponse
    const calls: string[] = []
    const client = {
      connect: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      reconnect: vi.fn(async () => {
        calls.push('reconnect')
      }),
      request: vi.fn(async (method: string) => {
        calls.push(method)
        return method === 'thread/resume' ? resumeResponse : readResponse
      })
    }

    await expect(resumeThreadStreamAfterReactivation(client, {
      threadId: 'thread-1',
      cwd: '/tmp/project',
      approvalPolicy: 'never'
    })).resolves.toEqual({
      resumeResponse,
      readResponse
    })

    expect(calls).toEqual([
      'reconnect',
      'thread/resume',
      'thread/read'
    ])
    expect(client.request).toHaveBeenNthCalledWith(1, 'thread/resume', {
      threadId: 'thread-1',
      cwd: '/tmp/project',
      approvalPolicy: 'never'
    })
    expect(client.request).toHaveBeenNthCalledWith(2, 'thread/read', {
      threadId: 'thread-1',
      includeTurns: true
    })
  })

  it('restores a disconnected idle thread transport without resuming the thread', async () => {
    const client = {
      connect: vi.fn(async () => {}),
      reconnect: vi.fn(async () => {}),
      isConnected: vi.fn(() => false),
      request: vi.fn(async () => {
        throw new Error('Idle recovery must not issue thread RPC requests.')
      })
    }

    await expect(recoverThreadAfterReactivation(client, {
      threadId: 'thread-idle',
      cwd: '/tmp/project',
      approvalPolicy: 'never'
    }, {
      reconcileThread: false
    })).resolves.toBeNull()

    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.reconnect).not.toHaveBeenCalled()
    expect(client.request).not.toHaveBeenCalled()
  })

  it('lets connect preserve an already-open idle transport without resuming the thread', async () => {
    const client = {
      connect: vi.fn(async () => {}),
      reconnect: vi.fn(async () => {}),
      isConnected: vi.fn(() => true),
      request: vi.fn(async () => {
        throw new Error('Idle recovery must not issue thread RPC requests.')
      })
    }

    await recoverThreadAfterReactivation(client, {
      threadId: 'thread-idle',
      cwd: '/tmp/project',
      approvalPolicy: 'never'
    }, {
      reconcileThread: false
    })

    expect(client.connect).toHaveBeenCalledOnce()
    expect(client.reconnect).not.toHaveBeenCalled()
    expect(client.request).not.toHaveBeenCalled()
  })

  it('hydrates an ordinary thread view through resume and read', async () => {
    const resumeResponse = { thread: { id: 'thread-1' } } as unknown as ThreadResumeResponse
    const readResponse = { thread: { id: 'thread-1', turns: [] } } as unknown as ThreadReadResponse
    const client = {
      request: vi.fn(async (method: string) =>
        method === 'thread/resume' ? resumeResponse : readResponse)
    }

    await expect(hydrateThreadView(client, {
      threadId: 'thread-1',
      cwd: '/tmp/project',
      approvalPolicy: 'never'
    }, {
      resume: true
    })).resolves.toEqual({
      resumeResponse,
      readResponse
    })

    expect(client.request).toHaveBeenNthCalledWith(1, 'thread/resume', {
      threadId: 'thread-1',
      cwd: '/tmp/project',
      approvalPolicy: 'never'
    })
    expect(client.request).toHaveBeenNthCalledWith(2, 'thread/read', {
      threadId: 'thread-1',
      includeTurns: true
    })
  })

  it('reattaches a voice-owned thread view without resuming its runtime', async () => {
    const readResponse = { thread: { id: 'thread-voice', turns: [] } } as unknown as ThreadReadResponse
    const client = {
      request: vi.fn(async () => readResponse)
    }

    await expect(hydrateThreadView(client, {
      threadId: 'thread-voice',
      cwd: '/tmp/project',
      approvalPolicy: 'never'
    }, {
      resume: false
    })).resolves.toEqual({
      resumeResponse: null,
      readResponse
    })

    expect(client.request).toHaveBeenCalledOnce()
    expect(client.request).toHaveBeenCalledWith('thread/read', {
      threadId: 'thread-voice',
      includeTurns: true
    })
  })
})

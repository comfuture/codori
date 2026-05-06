// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isConstrainedBrowserRequiringDeferredSync,
  resumeThreadStreamAfterReactivation,
  shouldAttemptThreadReactivationSync
} from '../app/utils/thread-reactivation'
import type { ThreadReadResponse } from '../shared/generated/codex-app-server/v2/ThreadReadResponse'
import type { ThreadResumeResponse } from '../shared/generated/codex-app-server/v2/ThreadResumeResponse'

describe('thread reactivation policy', () => {
  afterEach(() => {
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

  it('rehydrates through thread/resume before thread/read after reconnecting', async () => {
    const resumeResponse = { thread: { id: 'thread-1' } } as unknown as ThreadResumeResponse
    const readResponse = { thread: { id: 'thread-1', turns: [] } } as unknown as ThreadReadResponse
    const calls: string[] = []
    const client = {
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
      approvalPolicy: 'never',
      persistExtendedHistory: true
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
      approvalPolicy: 'never',
      persistExtendedHistory: true
    })
    expect(client.request).toHaveBeenNthCalledWith(2, 'thread/read', {
      threadId: 'thread-1',
      includeTurns: true
    })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { applyActiveThreadTitleNotification } from '../app/utils/thread-title-notification'
import type { CodexRpcNotification } from '../shared/codex-rpc'

const titleNotification = (
  threadId: string,
  threadName?: string
): CodexRpcNotification => ({
  method: 'thread/name/updated',
  params: {
    threadId,
    threadName
  }
})

describe('active thread title notifications', () => {
  it('honors an app-server generated title across the active workspace surfaces', () => {
    const setThreadTitle = vi.fn()
    const syncSessionTitle = vi.fn()
    const updateThreadSummaryTitle = vi.fn()

    expect(applyActiveThreadTitleNotification(
      titleNotification('thread-1', 'Generated server title'),
      {
        activeThreadId: 'thread-1',
        setThreadTitle,
        syncSessionTitle,
        updateThreadSummaryTitle
      }
    )).toBe(true)

    expect(setThreadTitle).toHaveBeenCalledWith('Generated server title')
    expect(syncSessionTitle).toHaveBeenCalledWith('Generated server title')
    expect(updateThreadSummaryTitle)
      .toHaveBeenCalledWith('thread-1', 'Generated server title', undefined)
  })

  it('ignores generated names for another workspace thread', () => {
    const setThreadTitle = vi.fn()
    const syncSessionTitle = vi.fn()
    const updateThreadSummaryTitle = vi.fn()

    expect(applyActiveThreadTitleNotification(
      titleNotification('thread-2', 'Unrelated title'),
      {
        activeThreadId: 'thread-1',
        setThreadTitle,
        syncSessionTitle,
        updateThreadSummaryTitle
      }
    )).toBe(false)

    expect(setThreadTitle).not.toHaveBeenCalled()
    expect(syncSessionTitle).not.toHaveBeenCalled()
    expect(updateThreadSummaryTitle).not.toHaveBeenCalled()
  })

  it('normalizes Markdown links if a generated title contains them', () => {
    const setThreadTitle = vi.fn()

    expect(applyActiveThreadTitleNotification(
      titleNotification('thread-1', 'Use [@Browser](plugin://browser) next'),
      {
        activeThreadId: 'thread-1',
        setThreadTitle,
        syncSessionTitle: vi.fn(),
        updateThreadSummaryTitle: vi.fn()
      }
    )).toBe(true)

    expect(setThreadTitle).toHaveBeenCalledWith('Use @Browser next')
  })
})

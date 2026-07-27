import { describe, expect, it } from 'vitest'

import type { CodexRpcNotification } from '../shared/codex-rpc'
import {
  createRealtimeTranscriptState,
  createTranscriptVisibilityState,
  expireTranscriptVisibility,
  reconcileTranscriptVisibility,
  reduceRealtimeTranscriptNotification,
  resetRealtimeTranscript,
  resolveCurrentAssistantTranscript
} from '../shared/realtime-transcript'

const notification = (
  method: 'thread/realtime/transcript/delta' | 'thread/realtime/transcript/done',
  params: Record<string, unknown>
) => ({ method, params }) as CodexRpcNotification

describe('shared realtime transcript reconciliation', () => {
  it('appends deltas, finalizes in place, and ignores repeated final text', () => {
    const context = { generation: 1, threadId: 'thread-1', started: true }
    let state = createRealtimeTranscriptState()
    state = reduceRealtimeTranscriptNotification(state, notification(
      'thread/realtime/transcript/delta',
      { threadId: 'thread-1', role: 'assistant', delta: '안녕' }
    ), context)
    state = reduceRealtimeTranscriptNotification(state, notification(
      'thread/realtime/transcript/delta',
      { threadId: 'thread-1', role: 'assistant', delta: '하세요' }
    ), context)
    state = reduceRealtimeTranscriptNotification(state, notification(
      'thread/realtime/transcript/done',
      { threadId: 'thread-1', role: 'assistant', text: '안녕하세요' }
    ), context)
    const finalized = state
    state = reduceRealtimeTranscriptNotification(state, notification(
      'thread/realtime/transcript/done',
      { threadId: 'thread-1', role: 'assistant', text: '안녕하세요' }
    ), context)

    expect(state).toBe(finalized)
    expect(state.segments).toEqual([{
      id: 1,
      generation: 1,
      role: 'assistant',
      text: '안녕하세요',
      final: true
    }])
  })

  it('filters stale thread notifications and resets content across generations', () => {
    const initial = reduceRealtimeTranscriptNotification(
      createRealtimeTranscriptState(),
      notification('thread/realtime/transcript/done', {
        threadId: 'thread-1',
        role: 'user',
        text: 'old'
      }),
      { generation: 1, threadId: 'thread-1', started: true }
    )
    expect(reduceRealtimeTranscriptNotification(initial, notification(
      'thread/realtime/transcript/delta',
      { threadId: 'other', role: 'assistant', delta: 'ignored' }
    ), { generation: 1, threadId: 'thread-1', started: true })).toBe(initial)

    const reset = resetRealtimeTranscript(initial, 2)
    expect(reset.segments).toEqual([])
    expect(reset.nextSegmentId).toBe(1)
  })
})

describe('shared transcript visibility', () => {
  const segments = [{
    id: 1,
    generation: 3,
    role: 'assistant' as const,
    text: 'First',
    final: false
  }]

  it('expires after five unchanged seconds and reopens when text changes', () => {
    let state = reconcileTranscriptVisibility(createTranscriptVisibilityState(), {
      active: true,
      segments,
      generation: 3,
      roles: ['assistant'],
      nowMs: 1_000
    })
    expect(expireTranscriptVisibility(state, 5_999).visible).toBe(true)
    state = expireTranscriptVisibility(state, 6_000)
    expect(state.visible).toBe(false)

    state = reconcileTranscriptVisibility(state, {
      active: true,
      segments: [{ ...segments[0]!, text: 'First update' }],
      generation: 3,
      roles: ['assistant'],
      nowMs: 7_000
    })
    expect(state).toMatchObject({ visible: true, hideAtMs: 12_000 })
  })

  it('supports assistant-only surfaces without mixing speech before the latest user boundary', () => {
    const conversation = [
      { id: 1, generation: 1, role: 'assistant' as const, text: 'Old', final: true },
      { id: 2, generation: 1, role: 'user' as const, text: 'Next', final: true },
      { id: 3, generation: 1, role: 'assistant' as const, text: 'New', final: true },
      { id: 4, generation: 1, role: 'assistant' as const, text: 'answer', final: false }
    ]
    expect(resolveCurrentAssistantTranscript(conversation, 1)).toBe('New answer')
  })
})

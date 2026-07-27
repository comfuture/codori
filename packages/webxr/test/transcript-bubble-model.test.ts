import { describe, expect, it } from 'vitest'
import { TranscriptBubbleModel } from '../src/transcript-bubble-model'

describe('assistant transcript bubble model', () => {
  it('filters non-assistant roles and opens for assistant content', () => {
    const model = new TranscriptBubbleModel()
    expect(model.update([{
      id: 1,
      generation: 1,
      role: 'user',
      text: 'hello',
      final: false
    }], 1, 0).open).toBe(false)
    expect(model.update([{
      id: 2,
      generation: 1,
      role: 'unknown',
      text: 'ignored',
      final: false
    }, {
      id: 3,
      generation: 1,
      role: 'assistant',
      text: '안녕하세요 👋 `code`',
      final: false
    }], 1, 1).text).toBe('안녕하세요 👋 `code`')
  })

  it('holds for thirty seconds after final speech and then scales away', () => {
    const model = new TranscriptBubbleModel()
    const segment = {
      id: 1,
      generation: 1,
      role: 'assistant' as const,
      text: 'First',
      final: false
    }
    expect(model.update([segment], 1, 0)).toMatchObject({
      open: true,
      phase: 'appearing'
    })
    expect(model.current(250).phase).toBe('visible')
    expect(model.update([{
      ...segment,
      text: 'First delta',
      final: true
    }], 1, 4_999).phase).toBe('visible')
    expect(model.current(34_998).phase).toBe('visible')
    expect(model.current(34_999)).toMatchObject({
      open: true,
      phase: 'disappearing'
    })
    expect(model.current(35_248).open).toBe(true)
    expect(model.current(35_249)).toMatchObject({
      open: false,
      phase: 'hidden'
    })
  })

  it('reopens and appends when speech continues during dismissal', () => {
    const model = new TranscriptBubbleModel()
    const first = {
      id: 1,
      generation: 1,
      role: 'assistant' as const,
      text: 'First',
      final: true
    }
    model.update([first], 1, 0)
    model.current(250)
    expect(model.current(30_000).phase).toBe('disappearing')

    expect(model.update([first, {
      ...first,
      id: 2,
      text: 'Second',
      final: false
    }], 1, 30_100)).toMatchObject({
      open: true,
      text: 'First Second',
      phase: 'appearing'
    })
  })

  it('clears old speech on generation change and reopens for the next utterance', () => {
    const model = new TranscriptBubbleModel()
    model.update([{
      id: 1,
      generation: 1,
      role: 'assistant',
      text: 'Old',
      final: true
    }], 1, 0)

    expect(model.update([], 2, 10)).toMatchObject({
      open: false,
      text: '',
      generation: 2
    })
    expect(model.update([{
      id: 1,
      generation: 2,
      role: 'assistant',
      text: 'New',
      final: false
    }], 2, 20)).toMatchObject({
      open: true,
      text: 'New',
      generation: 2
    })
  })
})

import { describe, expect, it } from 'vitest'
import { resolveTranscriptBubbleScale } from '../src/transcript-bubble-view'

describe('assistant transcript bubble animation', () => {
  it('scales in and out over a quarter second', () => {
    expect(resolveTranscriptBubbleScale('hidden', 0)).toBe(0)
    expect(resolveTranscriptBubbleScale('appearing', 0)).toBe(0)
    expect(resolveTranscriptBubbleScale('appearing', 125)).toBeGreaterThan(0.8)
    expect(resolveTranscriptBubbleScale('appearing', 250)).toBe(1)
    expect(resolveTranscriptBubbleScale('visible', 10_000)).toBe(1)
    expect(resolveTranscriptBubbleScale('disappearing', 0)).toBe(1)
    expect(resolveTranscriptBubbleScale('disappearing', 250)).toBe(0)
  })
})

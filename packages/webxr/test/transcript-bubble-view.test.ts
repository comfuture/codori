import { describe, expect, it } from 'vitest'
import {
  resolveTranscriptBubbleScale,
  shouldRenderTranscriptTexture,
  TRANSCRIPT_BUBBLE_APPEARANCE
} from '../src/transcript-bubble-view'

describe('assistant transcript bubble animation', () => {
  it('uses a sky-blue translucent surface for passthrough contrast', () => {
    expect(TRANSCRIPT_BUBBLE_APPEARANCE.background)
      .toBe('rgba(12, 70, 96, 0.62)')
    expect(TRANSCRIPT_BUBBLE_APPEARANCE.border)
      .toBe('rgba(104, 225, 255, 0.96)')
    expect(TRANSCRIPT_BUBBLE_APPEARANCE.text).toBe('#d9f8ff')
  })
  it('scales in and out over a quarter second', () => {
    expect(resolveTranscriptBubbleScale('hidden', 0)).toBe(0)
    expect(resolveTranscriptBubbleScale('appearing', 0)).toBe(0)
    expect(resolveTranscriptBubbleScale('appearing', 125)).toBeGreaterThan(0.8)
    expect(resolveTranscriptBubbleScale('appearing', 250)).toBe(1)
    expect(resolveTranscriptBubbleScale('visible', 10_000)).toBe(1)
    expect(resolveTranscriptBubbleScale('disappearing', 0)).toBe(1)
    expect(resolveTranscriptBubbleScale('disappearing', 250)).toBe(0)
  })

  it('limits partial transcript uploads to four hertz and renders finals immediately', () => {
    const input = {
      visibleText: 'Hello',
      visibleGeneration: 1,
      nextText: 'Hello world',
      nextGeneration: 1,
      final: false,
      lastRenderedAt: 1_000
    }
    expect(shouldRenderTranscriptTexture({
      ...input,
      now: 1_249
    })).toBe(false)
    expect(shouldRenderTranscriptTexture({
      ...input,
      now: 1_250
    })).toBe(true)
    expect(shouldRenderTranscriptTexture({
      ...input,
      final: true,
      now: 1_001
    })).toBe(true)
    expect(shouldRenderTranscriptTexture({
      ...input,
      nextText: input.visibleText,
      final: true,
      now: 1_250
    })).toBe(false)
  })

  it('clears a previous generation and renders its first delta immediately', () => {
    expect(shouldRenderTranscriptTexture({
      visibleText: 'Previous answer',
      visibleGeneration: 1,
      nextText: '',
      nextGeneration: 2,
      final: false,
      lastRenderedAt: 1_000,
      now: 1_010
    })).toBe(true)
    expect(shouldRenderTranscriptTexture({
      visibleText: '',
      visibleGeneration: 2,
      nextText: 'Next answer',
      nextGeneration: 2,
      final: false,
      lastRenderedAt: Number.NEGATIVE_INFINITY,
      now: 1_011
    })).toBe(true)
  })
})

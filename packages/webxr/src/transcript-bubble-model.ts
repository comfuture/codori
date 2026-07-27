import {
  createTranscriptVisibilityState,
  expireTranscriptVisibility,
  reconcileTranscriptVisibility,
  resolveCurrentAssistantTranscript,
  type RealtimeTranscriptSegment,
  type TranscriptVisibilityState
} from '@codori/client/shared/realtime-transcript'
import { TRANSCRIPT_INACTIVITY_MS } from './config'

export type TranscriptBubbleSegment = RealtimeTranscriptSegment

export type TranscriptBubbleSnapshot = {
  open: boolean
  text: string
  generation: number
  segmentId: number | null
  changedAt: number
}

export class TranscriptBubbleModel {
  private visibility: TranscriptVisibilityState =
    createTranscriptVisibilityState()

  private text = ''

  private segmentId: number | null = null

  private changedAt = 0

  update(
    segments: readonly TranscriptBubbleSegment[],
    generation: number,
    now: number
  ): TranscriptBubbleSnapshot {
    const nextText = resolveCurrentAssistantTranscript(segments, generation)
    const latestAssistant = [...segments].reverse().find(segment =>
      segment.generation === generation
      && segment.role === 'assistant'
      && Boolean(segment.text.trim())
    )
    const nextVisibility = reconcileTranscriptVisibility(
      this.visibility,
      {
        active: true,
        segments,
        generation,
        roles: ['assistant'],
        nowMs: now,
        inactivityMs: TRANSCRIPT_INACTIVITY_MS
      }
    )
    if (
      this.visibility.generation !== nextVisibility.generation
      || this.visibility.signature !== nextVisibility.signature
    ) {
      this.text = nextText
      this.segmentId = latestAssistant?.id ?? null
      this.changedAt = now
    }
    this.visibility = nextVisibility
    return this.snapshot()
  }

  current(now: number): TranscriptBubbleSnapshot {
    this.visibility = expireTranscriptVisibility(this.visibility, now)
    return this.snapshot()
  }

  reset(generation: number, now: number) {
    this.visibility = createTranscriptVisibilityState(generation)
    this.text = ''
    this.segmentId = null
    this.changedAt = now
  }

  private snapshot(): TranscriptBubbleSnapshot {
    return {
      open: this.visibility.visible,
      text: this.text,
      generation: this.visibility.generation,
      segmentId: this.segmentId,
      changedAt: this.changedAt
    }
  }
}

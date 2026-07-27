import {
  createTranscriptVisibilityState,
  expireTranscriptVisibility,
  reconcileTranscriptVisibility,
  resolveCurrentAssistantTranscript,
  type RealtimeTranscriptSegment,
  type TranscriptVisibilityState
} from '@codori/client/shared/realtime-transcript'
import {
  TRANSCRIPT_ANIMATION_MS,
  TRANSCRIPT_INACTIVITY_MS
} from './config'

export type TranscriptBubbleSegment = RealtimeTranscriptSegment

export type TranscriptBubblePhase =
  | 'hidden'
  | 'appearing'
  | 'visible'
  | 'disappearing'

export type TranscriptBubbleSnapshot = {
  open: boolean
  text: string
  generation: number
  segmentId: number | null
  changedAt: number
  phase: TranscriptBubblePhase
  phaseStartedAt: number
}

export class TranscriptBubbleModel {
  private visibility: TranscriptVisibilityState =
    createTranscriptVisibilityState()

  private text = ''

  private segmentId: number | null = null

  private changedAt = 0

  private phase: TranscriptBubblePhase = 'hidden'

  private phaseStartedAt = 0

  private advancePhase(now: number) {
    if (
      this.phase === 'appearing'
      && now - this.phaseStartedAt >= TRANSCRIPT_ANIMATION_MS
    ) {
      this.phase = 'visible'
      this.phaseStartedAt = now
    } else if (
      this.phase === 'disappearing'
      && now - this.phaseStartedAt >= TRANSCRIPT_ANIMATION_MS
    ) {
      this.phase = 'hidden'
      this.phaseStartedAt = now
    }
  }

  private reconcilePhase(wasVisible: boolean, now: number) {
    if (this.visibility.visible) {
      if (
        !wasVisible
        || this.phase === 'hidden'
        || this.phase === 'disappearing'
      ) {
        this.phase = 'appearing'
        this.phaseStartedAt = now
      } else {
        this.advancePhase(now)
      }
      return
    }
    if (wasVisible && this.phase !== 'hidden') {
      this.phase = 'disappearing'
      this.phaseStartedAt = now
      return
    }
    this.advancePhase(now)
  }

  update(
    segments: readonly TranscriptBubbleSegment[],
    generation: number,
    now: number
  ): TranscriptBubbleSnapshot {
    const wasVisible = this.visibility.visible
    const generationChanged = this.visibility.generation !== generation
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
    if (generationChanged && !nextText) {
      this.phase = 'hidden'
      this.phaseStartedAt = now
      return this.snapshot()
    }
    this.reconcilePhase(wasVisible, now)
    return this.snapshot()
  }

  current(now: number): TranscriptBubbleSnapshot {
    const wasVisible = this.visibility.visible
    this.visibility = expireTranscriptVisibility(this.visibility, now)
    this.reconcilePhase(wasVisible, now)
    return this.snapshot()
  }

  reset(generation: number, now: number) {
    this.visibility = createTranscriptVisibilityState(generation)
    this.text = ''
    this.segmentId = null
    this.changedAt = now
    this.phase = 'hidden'
    this.phaseStartedAt = now
  }

  private snapshot(): TranscriptBubbleSnapshot {
    return {
      open: this.phase !== 'hidden',
      text: this.text,
      generation: this.visibility.generation,
      segmentId: this.segmentId,
      changedAt: this.changedAt,
      phase: this.phase,
      phaseStartedAt: this.phaseStartedAt
    }
  }
}

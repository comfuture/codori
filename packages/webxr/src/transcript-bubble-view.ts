import { Group } from 'three'
import {
  TRANSCRIPT_ANIMATION_MS,
  TRANSCRIPT_RENDER_INTERVAL_MS
} from './config'
import type {
  TranscriptBubblePhase,
  TranscriptBubbleSnapshot
} from './transcript-bubble-model'
import { CanvasTextSurface } from './text-surface'

const easeOutCubic = (value: number) => 1 - ((1 - value) ** 3)

export const resolveTranscriptBubbleScale = (
  phase: TranscriptBubblePhase,
  elapsedMs: number
) => {
  if (phase === 'hidden') {
    return 0
  }
  if (phase === 'visible') {
    return 1
  }
  const progress = Math.min(
    1,
    Math.max(0, elapsedMs) / TRANSCRIPT_ANIMATION_MS
  )
  const eased = easeOutCubic(progress)
  return phase === 'appearing' ? eased : 1 - eased
}

export const shouldRenderTranscriptTexture = (input: {
  visibleText: string
  visibleGeneration: number | null
  nextText: string
  nextGeneration: number
  final: boolean
  lastRenderedAt: number
  now: number
}) => input.nextGeneration !== input.visibleGeneration
  || (
    input.nextText !== input.visibleText
    && (
      input.final
      || input.now - input.lastRenderedAt >= TRANSCRIPT_RENDER_INTERVAL_MS
    )
  )

export class TranscriptBubbleView {
  readonly group = new Group()

  private readonly surface = new CanvasTextSurface({
    widthMeters: 1.85,
    heightMeters: 0.62,
    widthPixels: 1_536,
    heightPixels: 560,
    background: 'rgba(2, 16, 28, 0.2)',
    border: 'rgba(65, 221, 255, 0.9)',
    color: '#79e8ff',
    font: 'Inter, system-ui, "Noto Sans CJK KR", "Apple Color Emoji", sans-serif',
    lineHeightPixels: 52,
    paddingPixels: 60,
    glow: true
  })

  private visibleText = ''

  private visibleGeneration: number | null = null

  private lastRenderedAt = Number.NEGATIVE_INFINITY

  constructor() {
    this.group.name = 'assistant-transcript-bubble'
    this.group.visible = false
    this.group.add(this.surface.mesh)
  }

  update(snapshot: TranscriptBubbleSnapshot, now: number) {
    const scale = resolveTranscriptBubbleScale(
      snapshot.phase,
      now - snapshot.phaseStartedAt
    )
    this.group.visible = snapshot.open
      && Boolean(snapshot.text)
      && scale > 0
    this.group.scale.setScalar(Math.max(0.001, scale))
    if (!shouldRenderTranscriptTexture({
      visibleText: this.visibleText,
      visibleGeneration: this.visibleGeneration,
      nextText: snapshot.text,
      nextGeneration: snapshot.generation,
      final: snapshot.final,
      lastRenderedAt: this.lastRenderedAt,
      now
    })) {
      return
    }
    this.visibleText = snapshot.text
    this.visibleGeneration = snapshot.generation
    this.lastRenderedAt = snapshot.text
      ? now
      : Number.NEGATIVE_INFINITY
    this.surface.render({
      title: 'Codex',
      body: snapshot.text
    })
  }

  dispose() {
    this.surface.dispose()
    this.group.clear()
  }
}

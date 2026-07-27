import { Group } from 'three'
import type { TranscriptBubbleSnapshot } from './transcript-bubble-model'
import { CanvasTextSurface } from './text-surface'

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

  constructor() {
    this.group.name = 'assistant-transcript-bubble'
    this.group.visible = false
    this.group.add(this.surface.mesh)
  }

  update(snapshot: TranscriptBubbleSnapshot) {
    this.group.visible = snapshot.open && Boolean(snapshot.text)
    if (snapshot.text === this.visibleText) {
      return
    }
    this.visibleText = snapshot.text
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

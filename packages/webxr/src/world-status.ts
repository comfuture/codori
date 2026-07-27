import { Group } from 'three'
import { CanvasTextSurface } from './text-surface'

export class WorldStatus {
  readonly group = new Group()

  private readonly surface = new CanvasTextSurface({
    widthMeters: 1.55,
    heightMeters: 0.34,
    widthPixels: 1_280,
    heightPixels: 360,
    background: 'rgba(8, 20, 30, 0.62)',
    border: 'rgba(83, 205, 237, 0.58)',
    color: '#bfeeff',
    font: 'Inter, system-ui, "Noto Sans CJK KR", sans-serif',
    lineHeightPixels: 45,
    paddingPixels: 45
  })

  private message = ''

  constructor() {
    this.group.name = 'world-status'
    this.group.visible = false
    this.group.add(this.surface.mesh)
  }

  update(message: string, error = false) {
    const normalized = message.trim()
    this.group.visible = Boolean(normalized)
    if (!normalized || normalized === this.message) {
      return
    }
    this.message = normalized
    this.surface.render({
      title: error ? 'Action needed' : 'Workspace',
      body: normalized
    })
  }

  dispose() {
    this.surface.dispose()
    this.group.clear()
  }
}

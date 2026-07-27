import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial
} from 'three'
import { CanvasTextSurface } from './text-surface'

export type WorldControlAction = 'toggle-voice' | 'exit-xr'

const createControl = (
  action: WorldControlAction,
  label: string,
  x: number
) => {
  const group = new Group()
  const surface = new CanvasTextSurface({
    widthMeters: 0.62,
    heightMeters: 0.2,
    widthPixels: 720,
    heightPixels: 240,
    background: 'rgba(4, 22, 33, 0.72)',
    border: 'rgba(87, 220, 251, 0.72)',
    color: '#c7f5ff',
    font: 'Inter, system-ui, sans-serif',
    lineHeightPixels: 52,
    paddingPixels: 36
  })
  surface.render({ body: label })
  const hit = new Mesh(
    new BoxGeometry(0.64, 0.22, 0.06),
    new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
  )
  hit.userData.action = action
  hit.position.z = 0.01
  group.position.x = x
  group.add(surface.mesh, hit)
  return {
    action,
    group,
    hit,
    surface,
    dispose: () => {
      surface.dispose()
      hit.geometry.dispose()
      hit.material.dispose()
      group.clear()
    }
  }
}

export class WorldControls {
  readonly group = new Group()

  readonly hitTargets: Mesh[] = []

  private voice = createControl('toggle-voice', 'Start voice', -0.36)

  private exit = createControl('exit-xr', 'Exit', 0.36)

  private voiceActive = false

  constructor() {
    this.group.name = 'world-controls'
    this.group.add(this.voice.group, this.exit.group)
    this.hitTargets.push(this.voice.hit, this.exit.hit)
  }

  setVoiceActive(active: boolean) {
    if (active === this.voiceActive) {
      return
    }
    this.voiceActive = active
    this.voice.surface.render({
      body: active ? 'Stop voice' : 'Start voice'
    })
  }

  dispose() {
    this.voice.dispose()
    this.exit.dispose()
    this.hitTargets.length = 0
    this.group.clear()
  }
}

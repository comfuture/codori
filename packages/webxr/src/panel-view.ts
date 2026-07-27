import {
  BoxGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import {
  PANEL_ANIMATION_MS,
  PANEL_DEPTH_METERS,
  PANEL_INITIAL_SIZE_METERS
} from './config'
import type { SpatialPanelSnapshot } from './panel-model'
import { CanvasTextSurface } from './text-surface'

const easeOutCubic = (value: number) => 1 - ((1 - value) ** 3)

const statusLabel = (status: SpatialPanelSnapshot['status']) =>
  status.replace('-', ' ')

export class SpatialPanelView {
  readonly group = new Group()

  readonly contentHit: Mesh

  readonly grabHit: Mesh

  private readonly width = 1.55

  private readonly height = 0.92

  private readonly shellMaterial = new MeshBasicMaterial({
    color: '#071b2a',
    transparent: true,
    opacity: 0.5,
    depthWrite: false
  })

  private readonly shell = new Mesh(
    new RoundedBoxGeometry(
      this.width,
      this.height,
      PANEL_DEPTH_METERS,
      4,
      0.065
    ),
    this.shellMaterial
  )

  private readonly surface = new CanvasTextSurface({
    widthMeters: this.width - 0.035,
    heightMeters: this.height - 0.035,
    background: 'rgba(4, 18, 29, 0.5)',
    border: 'rgba(77, 197, 226, 0.45)',
    color: '#c6e7ee',
    font: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Noto Sans Mono CJK KR", monospace',
    lineHeightPixels: 36,
    paddingPixels: 54
  })

  private snapshot: SpatialPanelSnapshot

  private hovered = false

  private grabbed = false

  constructor(snapshot: SpatialPanelSnapshot) {
    this.snapshot = snapshot
    this.group.name = `panel:${snapshot.id}`
    this.group.userData.panelId = snapshot.id
    this.surface.mesh.position.z = (PANEL_DEPTH_METERS / 2) + 0.002
    this.group.add(this.shell, this.surface.mesh)

    const invisibleMaterial = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
    this.contentHit = new Mesh(
      new BoxGeometry(this.width, this.height * 0.72, 0.06),
      invisibleMaterial
    )
    this.contentHit.position.y = -this.height * 0.11
    this.contentHit.userData = {
      panelId: snapshot.id,
      hitZone: 'content'
    }
    this.grabHit = new Mesh(
      new BoxGeometry(this.width, this.height * 0.28, 0.075),
      invisibleMaterial.clone()
    )
    this.grabHit.position.y = this.height * 0.36
    this.grabHit.userData = {
      panelId: snapshot.id,
      hitZone: 'grab'
    }
    this.group.add(this.contentHit, this.grabHit)
    this.update(snapshot)
  }

  update(snapshot: SpatialPanelSnapshot) {
    this.snapshot = snapshot
    const body = [
      snapshot.cwd ? `cwd: ${snapshot.cwd}` : null,
      snapshot.retainedText,
      snapshot.exitCode == null ? null : `\nexit: ${snapshot.exitCode}`
    ].filter((value): value is string => value != null).join('\n')
    this.surface.render({
      title: snapshot.title,
      status: statusLabel(snapshot.status),
      body,
      ansi: true,
      scrollLine: snapshot.autoFollow
        ? undefined
        : snapshot.scrollOffset
    })
  }

  updateAnimation(now: number) {
    const elapsed = Math.max(0, now - this.snapshot.phaseStartedAt)
    const progress = Math.min(1, elapsed / PANEL_ANIMATION_MS)
    const visibleScale = easeOutCubic(progress)
    const targetScale = this.snapshot.phase === 'appearing'
      ? visibleScale
      : this.snapshot.phase === 'disappearing'
        ? 1 - visibleScale
        : 1
    const initialX = PANEL_INITIAL_SIZE_METERS / this.width
    const initialY = PANEL_INITIAL_SIZE_METERS / this.height
    this.group.scale.set(
      initialX + ((1 - initialX) * targetScale),
      initialY + ((1 - initialY) * targetScale),
      Math.max(0.05, targetScale)
    )
  }

  setInteraction(hovered: boolean, grabbed: boolean) {
    if (hovered === this.hovered && grabbed === this.grabbed) {
      return
    }
    this.hovered = hovered
    this.grabbed = grabbed
    const color = grabbed
      ? new Color('#8cecff')
      : hovered
        ? new Color('#2abfe7')
        : new Color('#071b2a')
    this.shellMaterial.color.copy(color)
    this.shellMaterial.opacity = grabbed ? 0.68 : hovered ? 0.58 : 0.5
  }

  moveTo(position: Vector3) {
    this.group.position.copy(position)
  }

  dispose() {
    this.surface.dispose()
    this.shell.geometry.dispose()
    this.shellMaterial.dispose()
    this.contentHit.geometry.dispose()
    if (Array.isArray(this.contentHit.material)) {
      this.contentHit.material.forEach(material => material.dispose())
    } else {
      this.contentHit.material.dispose()
    }
    this.grabHit.geometry.dispose()
    if (Array.isArray(this.grabHit.material)) {
      this.grabHit.material.forEach(material => material.dispose())
    } else {
      this.grabHit.material.dispose()
    }
    this.group.clear()
  }
}

import {
  AdditiveBlending,
  BufferGeometry,
  BoxGeometry,
  Color,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Vector3
} from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import {
  PANEL_ANIMATION_MS,
  PANEL_DEPTH_METERS,
  PANEL_FORCE_DISMISS_MS,
  PANEL_INITIAL_SIZE_METERS
} from './config'
import { resolveFileChangeFrame } from './file-change-visual'
import type {
  SpatialPanelPhase,
  SpatialPanelSnapshot
} from './panel-model'
import { CanvasTextSurface } from './text-surface'

const easeOutCubic = (value: number) => 1 - ((1 - value) ** 3)
const easeInCubic = (value: number) => value ** 3

export type PanelVisualState = {
  normalizedScale: number
  burstScale: number
  opacity: number
  particleProgress: number
}

export const resolvePanelVisualState = (
  phase: SpatialPanelPhase,
  elapsedMs: number
): PanelVisualState => {
  if (phase === 'bursting') {
    const progress = Math.min(
      1,
      Math.max(0, elapsedMs) / PANEL_FORCE_DISMISS_MS
    )
    const eased = easeInCubic(progress)
    return {
      normalizedScale: 1,
      burstScale: 1 + eased,
      opacity: 1 - eased,
      particleProgress: progress
    }
  }
  const progress = Math.min(
    1,
    Math.max(0, elapsedMs) / PANEL_ANIMATION_MS
  )
  const visibleScale = easeOutCubic(progress)
  return {
    normalizedScale: phase === 'appearing'
      ? visibleScale
      : phase === 'disappearing'
        ? 1 - visibleScale
        : 1,
    burstScale: 1,
    opacity: 1,
    particleProgress: 0
  }
}

const statusLabel = (status: SpatialPanelSnapshot['status']) =>
  status.replace('-', ' ')

export class SpatialPanelView {
  readonly group = new Group()

  readonly contentHit: Mesh

  readonly grabHit: Mesh

  readonly dismissHit: Mesh

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

  private readonly dismissSurface = new CanvasTextSurface({
    widthMeters: 0.24,
    heightMeters: 0.24,
    widthPixels: 256,
    heightPixels: 256,
    background: 'rgba(5, 24, 36, 0.9)',
    border: 'rgba(77, 197, 226, 0.9)',
    color: '#bdf4ff',
    font: 'Inter, system-ui, sans-serif',
    lineHeightPixels: 80,
    paddingPixels: 82,
    glow: true
  })

  private readonly dismissControl = new Group()

  private readonly particleOrigins: Float32Array

  private readonly particleVelocities: Float32Array

  private readonly particleGeometry = new BufferGeometry()

  private readonly particleMaterial = new PointsMaterial({
    color: '#4dc5e2',
    size: 0.028,
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthWrite: false
  })

  private readonly particles: Points

  private snapshot: SpatialPanelSnapshot

  private hovered = false

  private grabbed = false

  private lastRenderedContent = ''

  private animationNow = 0

  constructor(snapshot: SpatialPanelSnapshot) {
    this.snapshot = snapshot
    this.group.name = `panel:${snapshot.id}`
    this.group.userData.panelId = snapshot.id
    this.surface.mesh.position.z = (PANEL_DEPTH_METERS / 2) + 0.002
    this.group.add(this.shell, this.surface.mesh)
    this.dismissSurface.render({ body: '×' })

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
    this.dismissHit = new Mesh(
      new BoxGeometry(0.27, 0.27, 0.08),
      invisibleMaterial.clone()
    )
    this.dismissHit.position.z = 0.01
    this.dismissHit.userData = {
      panelId: snapshot.id,
      hitZone: 'dismiss'
    }
    this.dismissControl.name = `panel-dismiss:${snapshot.id}`
    this.dismissControl.position.set(
      0,
      (-this.height / 2) - 0.16,
      0.025
    )
    this.dismissControl.visible = false
    this.dismissControl.add(
      this.dismissSurface.mesh,
      this.dismissHit
    )

    const particleCount = 28
    this.particleOrigins = new Float32Array(particleCount * 3)
    this.particleVelocities = new Float32Array(particleCount * 3)
    const particlePositions = new Float32Array(particleCount * 3)
    for (let index = 0; index < particleCount; index += 1) {
      const angle = (index / particleCount) * Math.PI * 2
      const x = Math.cos(angle) * (this.width / 2)
      const y = Math.sin(angle) * (this.height / 2)
      const offset = index * 3
      this.particleOrigins[offset] = x
      this.particleOrigins[offset + 1] = y
      this.particleOrigins[offset + 2] = 0.04
      this.particleVelocities[offset] = Math.cos(angle) * (
        0.18 + ((index % 4) * 0.035)
      )
      this.particleVelocities[offset + 1] = Math.sin(angle) * (
        0.15 + ((index % 5) * 0.028)
      )
      this.particleVelocities[offset + 2] = (
        ((index % 3) - 1) * 0.06
      )
      particlePositions[offset] = x
      particlePositions[offset + 1] = y
      particlePositions[offset + 2] = 0.04
    }
    this.particleGeometry.setAttribute(
      'position',
      new Float32BufferAttribute(particlePositions, 3)
    )
    this.particles = new Points(
      this.particleGeometry,
      this.particleMaterial
    )
    this.particles.name = `panel-dismiss-particles:${snapshot.id}`
    this.particles.visible = false
    this.group.add(
      this.contentHit,
      this.grabHit,
      this.dismissControl,
      this.particles
    )
    this.update(snapshot)
  }

  update(snapshot: SpatialPanelSnapshot) {
    this.snapshot = snapshot
    this.animationNow = Math.max(
      this.animationNow,
      snapshot.fileTransitionStartedAt
    )
    this.renderContent(this.animationNow)
  }

  private renderContent(now: number) {
    const snapshot = this.snapshot
    const body = snapshot.fileChange
      ? resolveFileChangeFrame({
          change: snapshot.fileChange,
          elapsedMs: Math.max(
            0,
            now - snapshot.fileTransitionStartedAt
          )
        })
      : [
          snapshot.cwd ? `cwd: ${snapshot.cwd}` : null,
          snapshot.retainedText,
          snapshot.exitCode == null ? null : `\nexit: ${snapshot.exitCode}`
        ].filter((value): value is string => value != null).join('\n')
    const scrollLine = snapshot.fileChange || snapshot.autoFollow
      ? undefined
      : snapshot.scrollOffset
    const signature = [
      snapshot.title,
      snapshot.status,
      body,
      scrollLine ?? ''
    ].join('\u0000')
    if (signature === this.lastRenderedContent) {
      return
    }
    this.lastRenderedContent = signature
    this.surface.render({
      title: snapshot.title,
      status: statusLabel(snapshot.status),
      body,
      ansi: true,
      scrollLine
    })
  }

  updateAnimation(now: number) {
    this.animationNow = now
    if (this.snapshot.fileChange) {
      this.renderContent(now)
    }
    const elapsed = Math.max(0, now - this.snapshot.phaseStartedAt)
    const visual = resolvePanelVisualState(
      this.snapshot.phase,
      elapsed
    )
    const initialX = PANEL_INITIAL_SIZE_METERS / this.width
    const initialY = PANEL_INITIAL_SIZE_METERS / this.height
    this.group.scale.set(
      (
        initialX + ((1 - initialX) * visual.normalizedScale)
      ) * visual.burstScale,
      (
        initialY + ((1 - initialY) * visual.normalizedScale)
      ) * visual.burstScale,
      Math.max(
        0.05,
        visual.normalizedScale * visual.burstScale
      )
    )
    this.surface.material.opacity = visual.opacity
    this.dismissSurface.material.opacity = visual.opacity
    this.shellMaterial.opacity = Math.min(
      this.shellMaterial.opacity,
      visual.opacity * 0.68
    )
    this.updateDismissParticles(visual.particleProgress)
  }

  private updateDismissParticles(progress: number) {
    if (this.snapshot.phase !== 'bursting') {
      this.particles.visible = false
      this.particleMaterial.opacity = 0
      return
    }
    const position = this.particleGeometry.getAttribute('position')
    for (let index = 0; index < position.count; index += 1) {
      const offset = index * 3
      position.setXYZ(
        index,
        this.particleOrigins[offset]!
          + (this.particleVelocities[offset]! * progress),
        this.particleOrigins[offset + 1]!
          + (this.particleVelocities[offset + 1]! * progress),
        this.particleOrigins[offset + 2]!
          + (this.particleVelocities[offset + 2]! * progress)
      )
    }
    position.needsUpdate = true
    this.particles.visible = progress < 1
    this.particleMaterial.opacity = Math.max(
      0,
      (1 - progress) * 0.95
    )
  }

  setInteraction(hovered: boolean, grabbed: boolean) {
    if (hovered === this.hovered && grabbed === this.grabbed) {
      return
    }
    this.hovered = hovered
    this.grabbed = grabbed
    this.dismissControl.visible = grabbed
      && this.snapshot.phase !== 'bursting'
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
    this.dismissSurface.dispose()
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
    this.dismissHit.geometry.dispose()
    if (Array.isArray(this.dismissHit.material)) {
      this.dismissHit.material.forEach(material => material.dispose())
    } else {
      this.dismissHit.material.dispose()
    }
    this.particleGeometry.dispose()
    this.particleMaterial.dispose()
    this.group.clear()
  }
}

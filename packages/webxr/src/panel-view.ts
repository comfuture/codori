import {
  AdditiveBlending,
  BufferGeometry,
  BoxGeometry,
  Color,
  EdgesGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  Shape,
  ShapeGeometry,
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
const PANEL_WIDTH_METERS = 1.55
const PANEL_MAX_HEIGHT_METERS = 0.92
const PANEL_MIN_HEIGHT_METERS = 0.44
const PANEL_MAX_SURFACE_HEIGHT_METERS = PANEL_MAX_HEIGHT_METERS - 0.035
const PANEL_MAX_SURFACE_HEIGHT_PIXELS = 896
const PANEL_BODY_COLUMNS = 72
const PANEL_CHROME_PIXELS = 160
const PANEL_LINE_HEIGHT_PIXELS = 36
export const PANEL_WORLD_DEPTH_RENDER_ORDER = 0
export const PANEL_CONTROL_SIZE_METERS = 0.15
export const PANEL_CONTROL_DEPTH_METERS = 0.028
export const PANEL_CONTROL_RADIUS_METERS = 0.022

export const resolvePanelControlLayout = (
  width: number,
  height: number
) => {
  const dismissX = (width / 2) - (PANEL_CONTROL_SIZE_METERS / 2)
  return {
    dismiss: {
      x: dismissX,
      y: (height / 2) + (PANEL_CONTROL_SIZE_METERS / 2) + 0.01
    }
  }
}

const displayColumns = (text: string) => [...text].reduce(
  (columns, character) => columns + (
    (character.codePointAt(0) ?? 0) > 0xff ? 2 : 1
  ),
  0
)

export const resolvePanelHeight = (body: string) => {
  const lines = body.split('\n').reduce(
    (count, line) => count + Math.max(
      1,
      Math.ceil(displayColumns(line) / PANEL_BODY_COLUMNS)
    ),
    0
  )
  const desiredPixels = Math.min(
    PANEL_MAX_SURFACE_HEIGHT_PIXELS,
    PANEL_CHROME_PIXELS + (
      Math.max(1, lines) * PANEL_LINE_HEIGHT_PIXELS
    )
  )
  const desiredMeters = (
    desiredPixels / PANEL_MAX_SURFACE_HEIGHT_PIXELS
  ) * PANEL_MAX_SURFACE_HEIGHT_METERS + 0.035
  return Math.min(
    PANEL_MAX_HEIGHT_METERS,
    Math.max(PANEL_MIN_HEIGHT_METERS, desiredMeters)
  )
}

export const resolvePanelInteractionLayout = (
  width: number,
  height: number
) => {
  const inset = 0.035
  const titleBarHeight = 0.11
  const titleBarY = (height / 2) - (titleBarHeight / 2) - 0.025
  const contentBottom = (-height / 2) + 0.025
  const contentTop = titleBarY - (titleBarHeight / 2) - 0.012
  return {
    titleBar: {
      width: width - (inset * 2),
      height: titleBarHeight,
      y: titleBarY
    },
    content: {
      width: width - (inset * 2),
      height: contentTop - contentBottom,
      y: (contentTop + contentBottom) / 2
    },
    move: {
      width,
      height,
      y: 0
    }
  }
}

export const createPanelContentRenderSignature = (input: {
  title: string
  status: string
  body: string
  scrollLine?: number
}) => [
  input.title,
  input.status,
  input.body,
  input.scrollLine ?? ''
].join('\u0000')

const triangleGeometry = (pointingUp: boolean) => {
  const shape = new Shape()
  const direction = pointingUp ? 1 : -1
  shape.moveTo(-0.035, -0.018 * direction)
  shape.lineTo(0.035, -0.018 * direction)
  shape.lineTo(0, 0.025 * direction)
  shape.closePath()
  return new ShapeGeometry(shape)
}

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

export const resolvePanelSlotTransition = (elapsedMs: number) =>
  easeOutCubic(Math.min(
    1,
    Math.max(0, elapsedMs) / PANEL_ANIMATION_MS
  ))

const statusLabel = (status: SpatialPanelSnapshot['status']) =>
  status.replace('-', ' ')

export class SpatialPanelView {
  readonly group = new Group()

  readonly moveHit: Mesh

  readonly dismissHit: Mesh

  readonly scrollUpHit: Mesh

  readonly scrollDownHit: Mesh

  private readonly width = PANEL_WIDTH_METERS

  private height = PANEL_MAX_HEIGHT_METERS

  private readonly titleBarMaterial = new MeshBasicMaterial({
    color: '#0c3347',
    transparent: true,
    opacity: 0.42,
    depthWrite: false
  })

  private readonly titleBar = new Mesh(
    new RoundedBoxGeometry(
      resolvePanelInteractionLayout(this.width, this.height).titleBar.width,
      resolvePanelInteractionLayout(this.width, this.height).titleBar.height,
      0.006,
      4,
      0.045
    ),
    this.titleBarMaterial
  )

  private outlineGeometry: EdgesGeometry

  private readonly outlineMaterial = new LineBasicMaterial({
    color: '#2abfe7',
    transparent: true,
    opacity: 0,
    depthTest: true,
    depthWrite: false
  })

  private readonly outline: LineSegments

  private glowGeometry: EdgesGeometry

  private readonly glowMaterial = new LineBasicMaterial({
    color: '#8cecff',
    transparent: true,
    opacity: 0,
    blending: AdditiveBlending,
    depthTest: true,
    depthWrite: false
  })

  private readonly glow: LineSegments

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
    widthMeters: 0.13,
    heightMeters: 0.13,
    widthPixels: 192,
    heightPixels: 192,
    background: 'rgba(5, 24, 36, 0.9)',
    border: 'rgba(77, 197, 226, 0.9)',
    color: '#bdf4ff',
    font: 'Inter, system-ui, sans-serif',
    lineHeightPixels: 92,
    paddingPixels: 44,
    bodyFontSizePixels: 84,
    glow: true,
    radiusPixels: 22
  })

  private readonly dismissControl = new Group()

  private readonly dismissButtonMaterial = new MeshBasicMaterial({
    color: '#0b4058',
    transparent: true,
    opacity: 0.96
  })

  private readonly dismissButton = new Mesh(
    new RoundedBoxGeometry(
      PANEL_CONTROL_SIZE_METERS,
      PANEL_CONTROL_SIZE_METERS,
      PANEL_CONTROL_DEPTH_METERS,
      4,
      PANEL_CONTROL_RADIUS_METERS
    ),
    this.dismissButtonMaterial
  )

  private readonly overflowMaterial = new MeshBasicMaterial({
    color: '#72e6ff',
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false
  })

  private readonly overflowDown = new Mesh(
    triangleGeometry(false),
    this.overflowMaterial
  )

  private readonly overflowUp = new Mesh(
    triangleGeometry(true),
    this.overflowMaterial.clone()
  )

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

  private active = false

  private outlineOpacity = 0

  private glowOpacity = 0

  private handControlsVisible = false

  private hasContentAbove = false

  private hasContentBelow = false

  get maximumScrollStart() {
    const metrics = this.surface.metrics
    return Math.max(0, metrics.totalLineCount - metrics.visibleLineCount)
  }

  private lastRenderedContent = ''

  private animationNow = 0

  private layoutPositionInitialized = false

  private layoutAnimating = false

  private readonly layoutFrom = new Vector3()

  private readonly layoutTarget = new Vector3()

  private layoutStartedAt = 0

  constructor(snapshot: SpatialPanelSnapshot) {
    this.snapshot = snapshot
    this.group.name = `panel:${snapshot.id}`
    this.group.userData.panelId = snapshot.id
    const chromeGeometry = new RoundedBoxGeometry(
      this.width + 0.018,
      this.height + 0.018,
      0.012,
      4,
      0.05
    )
    this.outlineGeometry = new EdgesGeometry(chromeGeometry, 24)
    this.glowGeometry = new EdgesGeometry(chromeGeometry, 24)
    chromeGeometry.dispose()
    this.outline = new LineSegments(
      this.outlineGeometry,
      this.outlineMaterial
    )
    this.glow = new LineSegments(this.glowGeometry, this.glowMaterial)
    this.outline.name = `panel-outline:${snapshot.id}`
    this.glow.name = `panel-glow:${snapshot.id}`
    this.outline.position.z = (PANEL_DEPTH_METERS / 2) + 0.012
    this.glow.position.z = (PANEL_DEPTH_METERS / 2) + 0.013
    this.glow.scale.setScalar(1.008)
    this.surface.mesh.renderOrder = PANEL_WORLD_DEPTH_RENDER_ORDER
    this.titleBar.renderOrder = PANEL_WORLD_DEPTH_RENDER_ORDER
    this.outline.renderOrder = PANEL_WORLD_DEPTH_RENDER_ORDER
    this.glow.renderOrder = PANEL_WORLD_DEPTH_RENDER_ORDER
    const interactionLayout = resolvePanelInteractionLayout(
      this.width,
      this.height
    )
    this.surface.mesh.position.z = (PANEL_DEPTH_METERS / 2) + 0.002
    this.titleBar.name = `panel-title-bar:${snapshot.id}`
    this.titleBar.position.set(0, interactionLayout.titleBar.y, 0.002)
    this.group.add(
      this.titleBar,
      this.surface.mesh,
      this.glow,
      this.outline
    )
    this.dismissSurface.mesh.position.z = (
      PANEL_CONTROL_DEPTH_METERS / 2
    ) + 0.001
    this.dismissSurface.render({ body: '', icon: 'close' })

    const invisibleMaterial = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
    this.moveHit = new Mesh(
      new BoxGeometry(
        interactionLayout.move.width,
        interactionLayout.move.height,
        0.06
      ),
      invisibleMaterial
    )
    this.moveHit.position.y = interactionLayout.move.y
    this.moveHit.userData = {
      panelId: snapshot.id,
      hitZone: 'move'
    }
    this.dismissHit = new Mesh(
      new BoxGeometry(
        PANEL_CONTROL_SIZE_METERS + 0.02,
        PANEL_CONTROL_SIZE_METERS + 0.02,
        0.08
      ),
      invisibleMaterial.clone()
    )
    this.dismissHit.position.z = 0.045
    this.dismissHit.userData = {
      panelId: snapshot.id,
      hitZone: 'dismiss'
    }
    this.dismissControl.name = `panel-dismiss:${snapshot.id}`
    this.positionActiveControls()
    this.dismissControl.visible = false
    this.dismissControl.add(
      this.dismissButton,
      this.dismissSurface.mesh,
      this.dismissHit
    )
    this.overflowUp.name = `panel-scroll-up:${snapshot.id}`
    this.overflowDown.name = `panel-scroll-down:${snapshot.id}`
    this.overflowUp.position.z = 0.05
    this.overflowDown.position.z = 0.05
    this.scrollUpHit = new Mesh(
      new BoxGeometry(0.13, 0.075, 0.07),
      invisibleMaterial.clone()
    )
    this.scrollDownHit = new Mesh(
      new BoxGeometry(0.13, 0.075, 0.07),
      invisibleMaterial.clone()
    )
    this.scrollUpHit.position.z = 0.045
    this.scrollDownHit.position.z = 0.045
    this.scrollUpHit.userData = {
      panelId: snapshot.id,
      hitZone: 'scroll-up'
    }
    this.scrollDownHit.userData = {
      panelId: snapshot.id,
      hitZone: 'scroll-down'
    }
    this.overflowUp.add(this.scrollUpHit)
    this.overflowDown.add(this.scrollDownHit)
    this.positionOverflowControls()

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
      this.moveHit,
      this.dismissControl,
      this.overflowUp,
      this.overflowDown,
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
    this.resizeHeight(resolvePanelHeight(
      snapshot.fileChange?.diff ?? body
    ))
    const scrollLine = snapshot.fileChange || snapshot.autoFollow
      ? undefined
      : snapshot.scrollOffset
    const signature = createPanelContentRenderSignature({
      title: snapshot.title,
      status: snapshot.status,
      body,
      scrollLine
    })
    if (signature === this.lastRenderedContent) {
      return
    }
    this.lastRenderedContent = signature
    const metrics = this.surface.render({
      title: snapshot.title,
      status: statusLabel(snapshot.status),
      body,
      ansi: true,
      scrollLine
    })
    this.hasContentAbove = metrics.hasAbove
    this.hasContentBelow = metrics.hasBelow
    this.updateOverflowVisibility()
  }

  private resizeHeight(height: number) {
    if (Math.abs(this.height - height) < 0.001) {
      return
    }
    this.height = height
    const interactionLayout = resolvePanelInteractionLayout(
      this.width,
      this.height
    )
    const surfaceHeight = this.height - 0.035
    this.surface.resize({
      widthMeters: this.width - 0.035,
      heightMeters: surfaceHeight,
      widthPixels: 1_536,
      heightPixels: Math.round(
        PANEL_MAX_SURFACE_HEIGHT_PIXELS
        * (surfaceHeight / PANEL_MAX_SURFACE_HEIGHT_METERS)
      )
    })
    this.titleBar.geometry.dispose()
    this.titleBar.geometry = new RoundedBoxGeometry(
      interactionLayout.titleBar.width,
      interactionLayout.titleBar.height,
      0.006,
      4,
      0.045
    )
    this.titleBar.position.y = interactionLayout.titleBar.y
    this.moveHit.geometry.dispose()
    this.moveHit.geometry = new BoxGeometry(
      interactionLayout.move.width,
      interactionLayout.move.height,
      0.06
    )
    this.moveHit.position.y = interactionLayout.move.y
    const chromeGeometry = new RoundedBoxGeometry(
      this.width + 0.018,
      this.height + 0.018,
      0.012,
      4,
      0.05
    )
    this.outlineGeometry.dispose()
    this.glowGeometry.dispose()
    this.outlineGeometry = new EdgesGeometry(chromeGeometry, 24)
    this.glowGeometry = new EdgesGeometry(chromeGeometry, 24)
    this.outline.geometry = this.outlineGeometry
    this.glow.geometry = this.glowGeometry
    chromeGeometry.dispose()
    this.positionActiveControls()
    this.positionOverflowControls()

    const position = this.particleGeometry.getAttribute('position')
    for (let index = 0; index < position.count; index += 1) {
      const angle = (index / position.count) * Math.PI * 2
      const offset = index * 3
      const x = Math.cos(angle) * (this.width / 2)
      const y = Math.sin(angle) * (this.height / 2)
      this.particleOrigins[offset] = x
      this.particleOrigins[offset + 1] = y
      position.setXYZ(index, x, y, this.particleOrigins[offset + 2]!)
    }
    position.needsUpdate = true
  }

  private positionActiveControls() {
    const layout = resolvePanelControlLayout(this.width, this.height)
    this.dismissControl.position.set(
      layout.dismiss.x,
      layout.dismiss.y,
      0.025
    )
  }

  private positionOverflowControls() {
    const inset = 0.055
    this.overflowUp.position.set(0, (this.height / 2) - inset, 0.045)
    this.overflowDown.position.set(0, (-this.height / 2) + inset, 0.045)
  }

  private updateOverflowVisibility() {
    this.overflowUp.visible = this.handControlsVisible && this.hasContentAbove
    this.overflowDown.visible = this.hasContentBelow
    this.scrollDownHit.visible = this.handControlsVisible && this.hasContentBelow
    this.scrollUpHit.visible = this.handControlsVisible && this.hasContentAbove
  }

  setHandControlsVisible(visible: boolean) {
    if (this.handControlsVisible === visible) {
      return
    }
    this.handControlsVisible = visible
    this.updateOverflowVisibility()
  }

  updateAnimation(now: number, reducedEffects = false) {
    this.animationNow = now
    if (this.layoutAnimating) {
      const progress = resolvePanelSlotTransition(
        now - this.layoutStartedAt
      )
      this.group.position.lerpVectors(
        this.layoutFrom,
        this.layoutTarget,
        progress
      )
      if (progress >= 1) {
        this.layoutAnimating = false
      }
    }
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
    this.titleBarMaterial.opacity = 0.42 * visual.opacity
    const overflowOpacity = reducedEffects
      ? 0.62
      : 0.38 + (0.42 * ((Math.sin(now / 260) + 1) / 2))
    this.overflowMaterial.opacity = this.hasContentBelow
      ? overflowOpacity * visual.opacity
      : 0
    ;(this.overflowUp.material as MeshBasicMaterial).opacity = (
      this.hasContentAbove ? overflowOpacity * visual.opacity : 0
    )
    this.outlineMaterial.opacity = this.outlineOpacity * visual.opacity
    this.glowMaterial.opacity = this.glowOpacity * visual.opacity
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

  setInteraction(
    hovered: boolean,
    grabbed: boolean,
    active = false
  ) {
    if (
      hovered === this.hovered
      && grabbed === this.grabbed
      && active === this.active
    ) {
      return
    }
    this.hovered = hovered
    this.grabbed = grabbed
    this.active = active
    this.dismissControl.visible = active
      && this.snapshot.phase !== 'bursting'
    const color = grabbed
      ? new Color('#b7f4ff')
      : hovered
        ? new Color('#63dcff')
        : new Color('#2abfe7')
    this.outlineMaterial.color.copy(color)
    this.glowMaterial.color.copy(color)
    this.outlineOpacity = grabbed ? 1 : hovered ? 0.78 : active ? 0.64 : 0
    this.glowOpacity = grabbed ? 0.5 : hovered ? 0.3 : active ? 0.22 : 0
    this.outlineMaterial.opacity = this.outlineOpacity
    this.glowMaterial.opacity = this.glowOpacity
  }

  moveTo(position: Vector3) {
    this.layoutPositionInitialized = true
    this.layoutAnimating = false
    this.layoutTarget.copy(position)
    this.group.position.copy(position)
  }

  placeInSlot(
    position: { x: number, y: number, z: number },
    now: number
  ) {
    if (!this.layoutPositionInitialized) {
      this.layoutPositionInitialized = true
      this.layoutTarget.set(position.x, position.y, position.z)
      this.group.position.copy(this.layoutTarget)
      return
    }
    if (
      this.layoutTarget.x === position.x
      && this.layoutTarget.y === position.y
      && this.layoutTarget.z === position.z
    ) {
      return
    }
    this.layoutFrom.copy(this.group.position)
    this.layoutTarget.set(position.x, position.y, position.z)
    this.layoutStartedAt = now
    this.layoutAnimating = true
  }

  dispose() {
    this.surface.dispose()
    this.dismissSurface.dispose()
    this.titleBar.geometry.dispose()
    this.titleBarMaterial.dispose()
    this.outlineGeometry.dispose()
    this.glowGeometry.dispose()
    this.outlineMaterial.dispose()
    this.glowMaterial.dispose()
    this.moveHit.geometry.dispose()
    if (Array.isArray(this.moveHit.material)) {
      this.moveHit.material.forEach(material => material.dispose())
    } else {
      this.moveHit.material.dispose()
    }
    this.dismissHit.geometry.dispose()
    if (Array.isArray(this.dismissHit.material)) {
      this.dismissHit.material.forEach(material => material.dispose())
    } else {
      this.dismissHit.material.dispose()
    }
    this.dismissButton.geometry.dispose()
    this.dismissButtonMaterial.dispose()
    this.overflowUp.geometry.dispose()
    this.overflowDown.geometry.dispose()
    this.overflowMaterial.dispose()
    ;(this.overflowUp.material as MeshBasicMaterial).dispose()
    this.scrollUpHit.geometry.dispose()
    this.scrollDownHit.geometry.dispose()
    ;(this.scrollUpHit.material as MeshBasicMaterial).dispose()
    ;(this.scrollDownHit.material as MeshBasicMaterial).dispose()
    this.particleGeometry.dispose()
    this.particleMaterial.dispose()
    this.group.clear()
  }
}

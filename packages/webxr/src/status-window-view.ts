import {
  BoxGeometry,
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace
} from 'three'
import type {
  StatusAction,
  StatusWindowSnapshot
} from './status-window-model'
import {
  createStatusActionRowLayout,
  createStatusQuotaRows,
  resolveStatusWindowScale
} from './status-window-model'
import { CanvasTextSurface } from './text-surface'

const WIDTH_METERS = 0.72
const HEIGHT_METERS = 0.96
const WIDTH_PIXELS = 720
const HEIGHT_PIXELS = 960
const ACTION_TOP_PIXELS = 570
const ACTION_AREA_PIXELS = 310

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const formatReset = (value: string | null) => {
  if (!value) {
    return 'reset unavailable'
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(value))
}

const progress = (
  context: CanvasRenderingContext2D,
  y: number,
  label: string,
  remainingPercent: number | null,
  detail: string
) => {
  context.fillStyle = '#dfffaa'
  context.font = '600 27px Inter, system-ui, sans-serif'
  context.fillText(label, 48, y)
  context.textAlign = 'right'
  context.fillText(
    remainingPercent == null
      ? 'Unavailable'
      : `${Math.round(remainingPercent)}% remaining`,
    WIDTH_PIXELS - 48,
    y
  )
  context.textAlign = 'left'
  context.fillStyle = 'rgba(220, 255, 167, 0.18)'
  context.fillRect(48, y + 18, WIDTH_PIXELS - 96, 14)
  if (remainingPercent != null) {
    context.fillStyle = '#b9f46f'
    context.fillRect(
      48,
      y + 18,
      (WIDTH_PIXELS - 96) * clamp01(remainingPercent / 100),
      14
    )
  }
  context.fillStyle = 'rgba(222, 255, 180, 0.66)'
  context.font = '22px Inter, system-ui, sans-serif'
  context.fillText(detail, 48, y + 62)
}

export class StatusWindowView {
  readonly group = new Group()

  readonly actionHits: Mesh<BoxGeometry, MeshBasicMaterial>[] = []

  readonly menuGroup = new Group()

  private readonly windowGroup = new Group()

  readonly menuHit: Mesh<BoxGeometry, MeshBasicMaterial>

  private readonly canvas = document.createElement('canvas')

  private readonly texture: CanvasTexture

  private readonly surface: Mesh<PlaneGeometry, MeshBasicMaterial>

  private readonly menuSurface = new CanvasTextSurface({
    widthMeters: 0.34,
    heightMeters: 0.14,
    widthPixels: 520,
    heightPixels: 210,
    background: 'rgba(52, 74, 18, 0.82)',
    border: 'rgba(194, 255, 116, 0.86)',
    color: '#e6ffbd',
    font: 'Inter, system-ui, sans-serif',
    lineHeightPixels: 38,
    paddingPixels: 38,
    titleFontSizePixels: 52,
    glow: true
  })

  private snapshot: StatusWindowSnapshot | null = null

  private phase: 'closed' | 'opening' | 'open' | 'closing' = 'closed'

  private phaseStartedAt = 0

  private menuRequested = false

  constructor() {
    this.group.name = 'status-window'
    this.group.visible = false
    this.canvas.width = WIDTH_PIXELS
    this.canvas.height = HEIGHT_PIXELS
    this.texture = new CanvasTexture(this.canvas)
    this.texture.colorSpace = SRGBColorSpace
    this.texture.minFilter = LinearFilter
    this.surface = new Mesh(
      new PlaneGeometry(WIDTH_METERS, HEIGHT_METERS),
      new MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        toneMapped: false
      })
    )
    this.surface.name = 'status-window-surface'
    this.windowGroup.position.y = -HEIGHT_METERS / 2
    this.surface.position.y = HEIGHT_METERS / 2
    this.group.add(this.windowGroup)
    this.windowGroup.add(this.surface)
    this.reconcileActionHits(0)

    this.menuSurface.render({ title: 'Menu', body: '' })
    this.menuHit = new Mesh(
      new BoxGeometry(0.36, 0.16, 0.04),
      new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    )
    this.menuHit.userData.statusMenu = true
    this.menuGroup.name = 'status-menu-affordance'
    this.menuGroup.visible = false
    this.menuGroup.add(this.menuSurface.mesh, this.menuHit)
  }

  private reconcileActionHits(count: number) {
    while (this.actionHits.length > count) {
      const hit = this.actionHits.pop()!
      hit.removeFromParent()
      hit.geometry.dispose()
      hit.material.dispose()
    }
    const rows = createStatusActionRowLayout(
      count,
      ACTION_TOP_PIXELS,
      ACTION_AREA_PIXELS
    )
    const rowPixels = rows[0]?.height ?? ACTION_AREA_PIXELS
    while (this.actionHits.length < count) {
      const index = this.actionHits.length
      const hit = new Mesh(
        new BoxGeometry(WIDTH_METERS - 0.08, rowPixels / HEIGHT_PIXELS * HEIGHT_METERS, 0.045),
        new MeshBasicMaterial({
          transparent: true,
          opacity: 0,
          depthWrite: false
        })
      )
      hit.position.z = 0.025
      hit.name = `status-action-${index}`
      this.actionHits.push(hit)
      this.windowGroup.add(hit)
    }
    this.actionHits.forEach((hit, index) => {
      const row = rows[index]!
      hit.scale.y = rowPixels / (
        (hit.geometry.parameters.height as number) * HEIGHT_PIXELS / HEIGHT_METERS
      )
      hit.position.y = (HEIGHT_METERS / 2)
        - ((row.top + row.height / 2) / HEIGHT_PIXELS * HEIGHT_METERS)
        + (HEIGHT_METERS / 2)
    })
  }

  get isOpen() {
    return this.phase === 'opening' || this.phase === 'open'
  }

  setSnapshot(snapshot: StatusWindowSnapshot) {
    this.snapshot = snapshot
    this.reconcileActionHits(snapshot.actions.length)
    snapshot.actions.forEach((action, index) => {
      const hit = this.actionHits[index]
      if (hit) {
        hit.userData.statusActionId = action.id
        hit.userData.statusActionAvailable = action.available
        hit.userData.statusInputPolicy = action.inputPolicy
      }
    })
    this.render()
  }

  setMenuVisible(visible: boolean) {
    this.menuRequested = visible
    this.menuGroup.visible = visible && !this.isOpen
  }

  open(now: number) {
    if (this.isOpen) {
      return false
    }
    this.phase = 'opening'
    this.phaseStartedAt = now
    this.group.visible = true
    this.menuGroup.visible = false
    return true
  }

  close(now: number) {
    if (this.phase === 'closed' || this.phase === 'closing') {
      return false
    }
    this.phase = 'closing'
    this.phaseStartedAt = now
    return true
  }

  toggle(now: number) {
    return this.isOpen ? this.close(now) : this.open(now)
  }

  update(now: number, reducedEffects: boolean) {
    const duration = reducedEffects ? 1 : this.phase === 'closing' ? 190 : 160
    const progressValue = clamp01((now - this.phaseStartedAt) / duration)
    if (this.phase === 'opening') {
      const scale = resolveStatusWindowScale('opening', progressValue)
      this.windowGroup.scale.set(scale.x, scale.y, 1)
      if (progressValue >= 1) {
        this.phase = 'open'
      }
    } else if (this.phase === 'closing') {
      // The child group pivots at the lower edge, so this collapses downward.
      const scale = resolveStatusWindowScale('closing', progressValue)
      this.windowGroup.scale.set(scale.x, scale.y, 1)
      if (progressValue >= 1) {
        this.phase = 'closed'
        this.group.visible = false
        this.menuGroup.visible = this.menuRequested
      }
    } else if (this.phase === 'open') {
      this.windowGroup.scale.set(1, 1, 1)
    }
  }

  private renderAction(
    context: CanvasRenderingContext2D,
    action: StatusAction,
    index: number
  ) {
    const row = createStatusActionRowLayout(
      this.snapshot?.actions.length ?? 0,
      ACTION_TOP_PIXELS,
      ACTION_AREA_PIXELS
    )[index]!
    const rowPixels = row.height
    const y = row.top
    context.fillStyle = action.available
      ? 'rgba(177, 235, 96, 0.09)'
      : 'rgba(125, 141, 100, 0.05)'
    context.fillRect(38, y + 4, WIDTH_PIXELS - 76, rowPixels - 8)
    context.fillStyle = action.available
      ? '#e3ffb8'
      : 'rgba(221, 236, 197, 0.48)'
    context.font = '600 27px Inter, system-ui, sans-serif'
    context.fillText(action.label, 56, y + Math.min(39, rowPixels * 0.68))
    context.textAlign = 'right'
    context.fillText(
      action.available ? (action.state ?? '›') : 'Unavailable',
      WIDTH_PIXELS - 56,
      y + Math.min(39, rowPixels * 0.68)
    )
    context.textAlign = 'left'
  }

  private render() {
    const context = this.canvas.getContext('2d')
    const snapshot = this.snapshot
    if (!context || !snapshot) {
      return
    }
    context.clearRect(0, 0, WIDTH_PIXELS, HEIGHT_PIXELS)
    context.fillStyle = 'rgba(44, 68, 16, 0.78)'
    context.fillRect(0, 0, WIDTH_PIXELS, HEIGHT_PIXELS)
    context.strokeStyle = 'rgba(194, 255, 116, 0.78)'
    context.lineWidth = 5
    context.strokeRect(4, 4, WIDTH_PIXELS - 8, HEIGHT_PIXELS - 8)
    context.shadowColor = 'rgba(187, 255, 105, 0.35)'
    context.shadowBlur = 18
    context.fillStyle = '#ecffc9'
    context.font = '700 42px Inter, system-ui, sans-serif'
    context.fillText('Codex status', 48, 68)
    context.shadowBlur = 0
    context.fillStyle = 'rgba(222, 255, 180, 0.7)'
    context.font = '23px Inter, system-ui, sans-serif'
    const identity = [snapshot.workspaceLabel, snapshot.threadLabel]
      .filter(Boolean).join(' · ') || 'Workspace identity unavailable'
    context.fillText(identity.slice(0, 48), 48, 108)

    const windows = createStatusQuotaRows(snapshot.rateLimits)
    const first = windows[0]
    const second = windows[1]
    if (first) {
      progress(
        context,
        144,
        first.label,
        first.remainingPercent,
        formatReset(first.resetsAt)
      )
    } else {
      progress(context, 144, 'Codex quota · primary', null, 'live quota unavailable')
    }
    progress(
      context,
      226,
      second?.label ?? 'Codex quota · secondary',
      second?.remainingPercent ?? null,
      second ? formatReset(second.resetsAt) : 'live quota unavailable'
    )
    progress(
      context,
      308,
      'Thread context',
      snapshot.context.remainingPercent,
      snapshot.context.remainingTokens == null
        ? 'context usage unavailable'
        : `${Math.round(snapshot.context.remainingTokens).toLocaleString()} tokens remaining`
    )
    context.fillStyle = 'rgba(222, 255, 180, 0.72)'
    context.font = '23px Inter, system-ui, sans-serif'
    context.fillText(
      `${snapshot.connection} · ${snapshot.voice} · ${snapshot.activePaneCount} panes`,
      48,
      420
    )
    context.fillText(snapshot.sessionLabel, 48, 454)
    context.strokeStyle = 'rgba(194, 255, 116, 0.42)'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(48, 478)
    context.lineTo(WIDTH_PIXELS - 48, 478)
    context.stroke()
    context.fillStyle = '#dfffaa'
    context.font = '700 24px Inter, system-ui, sans-serif'
    context.fillText('ACTIONS', 48, 530)
    snapshot.actions.forEach((action, index) => {
      this.renderAction(context, action, index)
    })
    const unavailable = snapshot.actions.find(action => !action.available)
    context.fillStyle = 'rgba(222, 255, 180, 0.58)'
    context.font = '20px Inter, system-ui, sans-serif'
    context.fillText(
      (unavailable?.disabledReason ?? 'Touch directly with a tracked index fingertip.').slice(0, 61),
      48,
      928
    )
    this.texture.needsUpdate = true
  }

  dispose() {
    this.surface.geometry.dispose()
    this.surface.material.dispose()
    this.texture.dispose()
    for (const hit of this.actionHits) {
      hit.geometry.dispose()
      hit.material.dispose()
    }
    this.menuHit.geometry.dispose()
    this.menuHit.material.dispose()
    this.menuSurface.dispose()
    this.actionHits.length = 0
    this.group.clear()
    this.windowGroup.clear()
    this.menuGroup.clear()
  }
}

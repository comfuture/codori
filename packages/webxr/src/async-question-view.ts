import { AdditiveBlending, BoxGeometry, BufferGeometry, Group, LineSegments, Mesh, MeshBasicMaterial, Shape, ShapeGeometry, Vector3 } from 'three'
import { CanvasTextSurface } from './text-surface'
import type { AsyncQuestionAction, AsyncQuestionSnapshot } from './async-question-model'
import type { AsyncQuestionTextInput } from './async-question-text-input'
import { createSpatialPanelGlowMaterial, createSpatialPanelOutlineMaterial, PANEL_WORLD_DEPTH_RENDER_ORDER } from './panel-view'

const WIDTH = 0.96
export const ASYNC_QUESTION_PANEL_WIDTH = WIDTH
export const ASYNC_QUESTION_PANEL_HEIGHT = 0.66
export const ASYNC_QUESTION_HOVER_OPACITY = 0.16

export const setAsyncQuestionHover = (targets: readonly Mesh[], hovered: Mesh | null) => {
  for (const target of targets) {
    (target.material as MeshBasicMaterial).opacity = target === hovered && typeof target.userData.asyncQuestionActivate === 'function' ? ASYNC_QUESTION_HOVER_OPACITY : 0
  }
}

export class AsyncQuestionView {
  readonly group = new Group()
  readonly hitTargets: Mesh[] = []
  private surfaces: CanvasTextSurface[] = []
  private frames: LineSegments[] = []
  private chrome: Mesh[] = []
  private snapshot: AsyncQuestionSnapshot = { history: [], currentId: null, submittingId: null, error: null }
  private signature = ''
  private questionIndex = 0
  private optionPage = 0
  private customInput = false
  private scrollLine = 0

  constructor(
    private readonly onAction: (action: AsyncQuestionAction) => void,
    private readonly textInput?: AsyncQuestionTextInput
  ) {
    this.group.name = 'async-user-question-panel'
    this.group.visible = false
  }

  get isOpen() { return this.snapshot.currentId !== null }

  update(snapshot: AsyncQuestionSnapshot) {
    const signature = JSON.stringify(snapshot)
    if (signature === this.signature) return
    const previousSnapshot = this.snapshot
    this.snapshot = snapshot
    this.signature = signature
    const entry = snapshot.history.find(entry => entry.id === snapshot.currentId)
    let resetInput = false
    if (snapshot.currentId !== previousSnapshot.currentId) {
      this.questionIndex = Math.max(0, entry?.answeredQuestions.findIndex(answered => !answered) ?? 0)
      resetInput = true
    } else {
      const previous = previousSnapshot.history.find(entry => entry.id === snapshot.currentId)
      if (entry?.answeredQuestions[this.questionIndex] && !previous?.answeredQuestions[this.questionIndex]) {
        const nextIndex = entry.answeredQuestions.findIndex(answered => !answered)
        if (nextIndex >= 0) this.questionIndex = nextIndex
        resetInput = true
      }
    }
    if (resetInput) {
      this.customInput = Boolean(entry && !entry.questions[this.questionIndex]?.options?.length)
      this.optionPage = 0
      this.scrollLine = 0
      this.textInput?.release()
    }
    this.render()
  }

  private surface(text: string, x: number, y: number, width: number, height: number, accent = false, scrollLine = 0) {
    const hero = height > 0.1
    const label = y > 0.25 || width < 0.075
    const surface = new CanvasTextSurface({
      widthMeters: width, heightMeters: height,
      widthPixels: Math.round(width * 1400), heightPixels: Math.round(height * 1400),
      background: 'rgba(0, 0, 0, 0)', border: 'rgba(0, 0, 0, 0)',
      color: accent ? '#91ffee' : hero ? '#eaffff' : '#a3c7d2',
      font: hero ? 'Inter, system-ui, sans-serif' : 'ui-monospace, SFMono-Regular, Menlo, monospace',
      lineHeightPixels: hero ? 55 : 40,
      bodyFontSizePixels: hero ? 47 : label ? 27 : 34, paddingPixels: 8, radiusPixels: 0
    })
    surface.render({ body: text, scrollLine })
    surface.mesh.position.set(x, y, 0)
    surface.mesh.position.z = 0.008
    surface.mesh.renderOrder = PANEL_WORLD_DEPTH_RENDER_ORDER
    this.group.add(surface.mesh)
    this.surfaces.push(surface)
    return surface
  }

  private button(text: string, x: number, y: number, width: number, activate: () => void, enabled = true, accent = false, height = 0.052) {
    const surface = this.surface(text, x, y, width, height, accent)
    if (!enabled) surface.material.opacity = 0.35
    if (!enabled) return
    const hit = new Mesh(new BoxGeometry(width, height, 0.006), new MeshBasicMaterial({
      color: '#d6f4ff', transparent: true, opacity: 0, depthWrite: false, depthTest: true
    }))
    hit.renderOrder = PANEL_WORLD_DEPTH_RENDER_ORDER
    hit.name = `async-question:${text}`
    hit.position.set(x, y, 0.016)
    hit.userData.asyncQuestionActivate = activate
    this.group.add(hit)
    this.hitTargets.push(hit)
  }

  private clear() {
    this.surfaces.forEach(surface => surface.dispose())
    this.surfaces = []
    for (const hit of this.hitTargets) {
      hit.geometry.dispose()
      ;(hit.material as MeshBasicMaterial).dispose()
    }
    this.hitTargets.length = 0
    for (const frame of this.frames) {
      frame.geometry.dispose()
      const materials = Array.isArray(frame.material) ? frame.material : [frame.material]
      materials.forEach(material => material.dispose())
    }
    this.frames = []
    for (const mesh of this.chrome) {
      mesh.geometry.dispose()
      ;(mesh.material as MeshBasicMaterial).dispose()
    }
    this.chrome = []
    this.group.clear()
  }

  private frame(width: number, height: number) {
    const w = width / 2
    const h = height / 2
    const cut = Math.min(0.055, height * 0.22)
    const vertices = [
      new Vector3(-w + cut, h, 0), new Vector3(w - cut * 2, h, 0),
      new Vector3(w, h - cut * 2, 0), new Vector3(w, -h + cut, 0),
      new Vector3(w - cut, -h, 0), new Vector3(-w + cut * 2, -h, 0),
      new Vector3(-w, -h + cut * 2, 0), new Vector3(-w, h - cut, 0)
    ]
    const shape = new Shape()
    shape.moveTo(vertices[0]!.x, vertices[0]!.y)
    vertices.slice(1).forEach(vertex => shape.lineTo(vertex.x, vertex.y))
    shape.closePath()
    const glass = new Mesh(new ShapeGeometry(shape), new MeshBasicMaterial({ color: '#041522', transparent: true, opacity: 0.9, depthWrite: false }))
    glass.name = 'async-question-glass'
    glass.position.z = -0.004
    this.chrome.push(glass)
    this.group.add(glass)
    const edges = vertices.flatMap((vertex, index) => [vertex, vertices[(index + 1) % vertices.length]!])
    const geometry = new BufferGeometry().setFromPoints(edges)
    const outlineMaterial = createSpatialPanelOutlineMaterial()
    const glowMaterial = createSpatialPanelGlowMaterial()
    outlineMaterial.color.set('#5dcfc3')
    outlineMaterial.opacity = 0.62
    glowMaterial.opacity = 0.32
    const outline = new LineSegments(geometry, outlineMaterial)
    const glow = new LineSegments(geometry.clone(), glowMaterial)
    outline.name = 'async-question-outline'
    glow.name = 'async-question-glow'
    outline.position.z = 0.022
    glow.position.z = 0.023
    glow.scale.setScalar(1.008)
    this.frames.push(outline, glow)
    this.group.add(glow, outline)
    // Physical light strips remain visible where WebGL implementations clamp line width to one pixel.
    const rail = (x: number, y: number, length: number, color: string, vertical = false) => {
      for (const [thickness, opacity] of [[0.014, 0.12], [0.006, 0.3], [0.0025, 0.95]]) {
        const strip = new Mesh(new BoxGeometry(vertical ? thickness! : length, vertical ? length : thickness!, 0.001),
          new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false }))
        strip.position.set(x, y, 0.024)
        this.chrome.push(strip)
        this.group.add(strip)
      }
    }
    rail(-w * 0.38, h, width * 0.42, '#8cffe9')
    rail(w * 0.56, -h, width * 0.22, '#8cffe9')
    if (height > 0.2) {
      rail(-w, h * 0.5, height * 0.23, '#36cdea', true)
      rail(w, -h * 0.3, height * 0.14, '#b99dff', true)
      rail(w * 0.34, h, width * 0.045, '#ffc783')
      rail(-w * 0.8, -h, width * 0.035, '#36cdea')
    }
  }

  private render() {
    this.clear()
    const { history, currentId, submittingId, error } = this.snapshot
    this.group.visible = history.length > 0
    if (!history.length) return
    const entry = history.find(entry => entry.id === currentId)
    if (!entry) {
      const latest = [...history].reverse().find(entry => !entry.answered) ?? history[history.length - 1]!
      this.button(`USER ANSWER / ${history.length}`, 0, 0, 0.43, () => this.onAction({ type: 'open', id: latest.id }), true, true)
      this.frame(0.45, 0.068)
      return
    }
    const index = Math.min(this.questionIndex, entry.questions.length - 1)
    const question = entry.questions[index]!
    const busy = submittingId !== null
    const focusInput = () => {
      if (busy) return
      this.customInput = true
      this.textInput?.focus({
        id: entry.id, index, label: question.title,
        value: entry.answers[index] ?? '',
        onChange: text => this.onAction({ type: 'answer', id: entry.id, index, text })
      })
      this.render()
    }
    this.frame(WIDTH, ASYNC_QUESTION_PANEL_HEIGHT)
    const blocker = new Mesh(new BoxGeometry(WIDTH, ASYNC_QUESTION_PANEL_HEIGHT, 0.002), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }))
    blocker.userData.asyncQuestionBlocker = true
    this.hitTargets.push(blocker)
    this.group.add(blocker)
    this.surface('USER ANSWER', -0.26, 0.278, 0.38, 0.044, true)
    this.surface(`${String(index + 1).padStart(2, '0')} / ${String(entry.questions.length).padStart(2, '0')}`, 0.185, 0.278, 0.21, 0.044)
    this.button('Dismiss', 0.365, 0.278, 0.17, () => { this.textInput?.release(); this.onAction({ type: 'dismiss' }) })
    const body = `${question.title}${error ? `\n${error}` : ''}`
    const text = this.surface(body, -0.025, 0.155, 0.86, 0.19, false, this.scrollLine)
    this.button('↑', 0.433, 0.205, 0.05, () => { this.scrollLine = Math.max(0, this.scrollLine - 3); this.render() })
    this.button('↓', 0.433, 0.115, 0.05, () => {
      this.scrollLine = Math.min(text.metrics.totalLineCount - 1, this.scrollLine + 3)
      this.render()
    })

    if (this.customInput) {
      this.button(entry.answers[index] || 'Click to type your answer', 0, -0.025, 0.86, focusInput, !busy, true, 0.17)
      if (question.options?.length) {
        this.button('Back to choices', -0.25, -0.19, 0.40, () => {
          this.textInput?.release()
          this.customInput = false
          this.render()
        })
      }
    } else {
      const options = question.options ?? []
      const start = this.optionPage * 3
      options.slice(start, start + 3).forEach((option, optionIndex) => {
        const y = 0.015 - optionIndex * 0.065
        this.surface(String(start + optionIndex + 1).padStart(2, '0'), -0.411, y, 0.07, 0.055, true)
        this.button(option, 0.04, y, 0.79,
          () => this.onAction({ type: 'send', index, text: option }), !busy, false, 0.056)
      })
      this.button('Write answer', -0.27, -0.19, 0.34, focusInput, !busy, true)
      if (options.length > 3) {
        this.button('Previous options', 0, -0.19, 0.27, () => { this.optionPage = Math.max(0, this.optionPage - 1); this.render() }, start > 0)
        this.button('More options', 0.31, -0.19, 0.27, () => { this.optionPage += 1; this.render() }, start + 3 < options.length)
      }
    }
    const navigateQuestion = (offset: number) => {
      this.textInput?.release()
      this.questionIndex += offset
      this.customInput = !entry.questions[this.questionIndex]?.options?.length
      this.optionPage = 0
      this.scrollLine = 0
      this.render()
    }
    if (index > 0) this.button('Previous', -0.35, -0.285, 0.20, () => navigateQuestion(-1))
    if (index + 1 < entry.questions.length) this.button('Next', -0.12, -0.285, 0.20, () => navigateQuestion(1))
    if (!this.customInput) this.surface('ANSWER WHEN READY', 0.225, -0.285, 0.45, 0.044, true)
    if (this.customInput) {
      this.button(busy ? 'Sending…' : 'Send response', 0.23, -0.285, 0.45,
        () => {
          if (this.textInput?.isComposing) return
          const draft = this.textInput?.release() ?? entry.answers[index] ?? ''
          this.onAction({ type: 'send', index, text: draft })
        }, !busy && Boolean(entry.answers[index]?.trim()), true)
    }

    const historyIndex = history.findIndex(candidate => candidate.id === entry.id)
    if (history.length > 1) {
      this.button('Earlier question', -0.245, -0.372, 0.43,
        () => this.onAction({ type: 'open', id: history[historyIndex - 1]!.id }), historyIndex > 0)
      this.button('Later question', 0.245, -0.372, 0.43,
        () => this.onAction({ type: 'open', id: history[historyIndex + 1]!.id }), historyIndex + 1 < history.length)
    }
  }

  dispose() { this.textInput?.release(); this.clear() }
}

import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace
} from 'three'
import {
  tokenizeAnsiOutput,
  type AnsiOutputSegment,
  type AnsiOutputStyle
} from '@codori/client/shared/ansi-output'
import {
  MAX_PANEL_CANVAS_EDGE,
  MAX_PANEL_OUTPUT_CHARS
} from './config'

export type TextSurfaceOptions = {
  widthMeters: number
  heightMeters: number
  widthPixels?: number
  heightPixels?: number
  background: string
  border: string
  color: string
  font: string
  lineHeightPixels: number
  paddingPixels: number
  opacity?: number
  glow?: boolean
}

export type TextSurfaceContent = {
  title?: string
  status?: string
  body: string
  scrollLine?: number
  ansi?: boolean
}

const clampCanvasSize = (value: number) =>
  Math.max(64, Math.min(MAX_PANEL_CANVAS_EDGE, Math.round(value)))

const defaultSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'word' })
  : null

export const wrapCanvasText = (
  context: CanvasRenderingContext2D,
  text: string,
  maximumWidth: number
) => {
  const lines: string[] = []
  for (const sourceLine of text.split('\n')) {
    if (!sourceLine) {
      lines.push('')
      continue
    }
    const tokens = defaultSegmenter
      ? [...defaultSegmenter.segment(sourceLine)].map(segment => segment.segment)
      : [...sourceLine]
    let line = ''
    for (const token of tokens) {
      const candidate = line + token
      if (line && context.measureText(candidate).width > maximumWidth) {
        lines.push(line.trimEnd())
        line = token.trimStart()
      } else {
        line = candidate
      }
    }
    lines.push(line)
  }
  return lines
}

type StyledLineRun = {
  text: string
  style: AnsiOutputStyle
}

const fontForStyle = (
  baseFont: string,
  sizePixels: number,
  style: AnsiOutputStyle
) => [
  style.fontStyle ?? 'normal',
  style.fontWeight ?? '400',
  `${sizePixels}px`,
  baseFont
].join(' ')

const wrapAnsiSegments = (
  context: CanvasRenderingContext2D,
  segments: readonly AnsiOutputSegment[],
  maximumWidth: number,
  font: string,
  sizePixels: number
) => {
  const lines: StyledLineRun[][] = [[]]
  let lineWidth = 0
  const nextLine = () => {
    lines.push([])
    lineWidth = 0
  }
  for (const segment of segments) {
    const sourceLines = segment.text.split('\n')
    for (const [sourceIndex, sourceLine] of sourceLines.entries()) {
      if (sourceIndex > 0) {
        nextLine()
      }
      const tokens = defaultSegmenter
        ? [...defaultSegmenter.segment(sourceLine)].map(candidate => candidate.segment)
        : [...sourceLine]
      for (const token of tokens) {
        context.font = fontForStyle(font, sizePixels, segment.style)
        const tokenWidth = context.measureText(token).width
        if (lineWidth > 0 && lineWidth + tokenWidth > maximumWidth) {
          nextLine()
        }
        const line = lines.at(-1)!
        const previous = line.at(-1)
        if (
          previous
          && JSON.stringify(previous.style) === JSON.stringify(segment.style)
        ) {
          previous.text += token
        } else {
          line.push({
            text: token,
            style: segment.style
          })
        }
        lineWidth += tokenWidth
      }
    }
  }
  return lines
}

const roundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

export class CanvasTextSurface {
  readonly canvas: HTMLCanvasElement

  readonly context: CanvasRenderingContext2D

  readonly texture: CanvasTexture

  readonly material: MeshBasicMaterial

  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>

  private readonly options: Required<TextSurfaceOptions>

  private disposed = false

  constructor(options: TextSurfaceOptions) {
    this.options = {
      widthPixels: 1_536,
      heightPixels: 896,
      opacity: 1,
      glow: false,
      ...options
    }
    this.canvas = document.createElement('canvas')
    this.canvas.width = clampCanvasSize(this.options.widthPixels)
    this.canvas.height = clampCanvasSize(this.options.heightPixels)
    const context = this.canvas.getContext('2d')
    if (!context) {
      throw new Error('Could not create a 2D canvas for immersive text.')
    }
    this.context = context
    this.texture = new CanvasTexture(this.canvas)
    this.texture.colorSpace = SRGBColorSpace
    this.texture.minFilter = LinearFilter
    this.texture.magFilter = LinearFilter
    this.material = new MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      opacity: this.options.opacity,
      depthWrite: false
    })
    this.mesh = new Mesh(
      new PlaneGeometry(
        this.options.widthMeters,
        this.options.heightMeters
      ),
      this.material
    )
    this.render({ body: '' })
  }

  render(content: TextSurfaceContent) {
    if (this.disposed) {
      return
    }
    const {
      width,
      height
    } = this.canvas
    const {
      background,
      border,
      color,
      font,
      lineHeightPixels,
      paddingPixels,
      glow
    } = this.options
    const context = this.context
    context.clearRect(0, 0, width, height)
    roundedRect(context, 3, 3, width - 6, height - 6, 42)
    context.fillStyle = background
    context.fill()
    context.lineWidth = 4
    context.strokeStyle = border
    if (glow) {
      context.shadowBlur = 22
      context.shadowColor = border
    }
    context.stroke()
    context.shadowBlur = 0

    let bodyTop = paddingPixels
    if (content.title || content.status) {
      context.font = `600 32px ${font}`
      context.fillStyle = color
      context.textBaseline = 'top'
      context.fillText(
        content.title ?? '',
        paddingPixels,
        paddingPixels,
        width - (paddingPixels * 2) - 220
      )
      if (content.status) {
        context.textAlign = 'right'
        context.fillStyle = border
        context.fillText(
          content.status,
          width - paddingPixels,
          paddingPixels,
          210
        )
        context.textAlign = 'left'
      }
      bodyTop += 52
      context.strokeStyle = 'rgb(130 207 230 / 18%)'
      context.lineWidth = 2
      context.beginPath()
      context.moveTo(paddingPixels, bodyTop - 10)
      context.lineTo(width - paddingPixels, bodyTop - 10)
      context.stroke()
    }

    const bodyFontSize = 27
    context.font = `400 ${bodyFontSize}px ${font}`
    context.fillStyle = color
    context.textBaseline = 'top'
    if (glow) {
      context.shadowBlur = 12
      context.shadowColor = color
    }
    const body = content.body.slice(-MAX_PANEL_OUTPUT_CHARS)
    const styledLines = content.ansi
      ? wrapAnsiSegments(
          context,
          tokenizeAnsiOutput(body),
          width - (paddingPixels * 2),
          font,
          bodyFontSize
        )
      : wrapCanvasText(
          context,
          body,
          width - (paddingPixels * 2)
        ).map(line => [{
          text: line,
          style: {} as AnsiOutputStyle
        }])
    const visibleLineCount = Math.max(
      1,
      Math.floor((height - bodyTop - paddingPixels) / lineHeightPixels)
    )
    const maximumStart = Math.max(0, styledLines.length - visibleLineCount)
    const startLine = content.scrollLine == null
      ? maximumStart
      : Math.min(maximumStart, Math.max(0, Math.round(content.scrollLine)))
    const visibleLines = styledLines.slice(
      startLine,
      startLine + visibleLineCount
    )
    for (const [lineIndex, line] of visibleLines.entries()) {
      let x = paddingPixels
      const y = bodyTop + (lineIndex * lineHeightPixels)
      for (const run of line) {
        context.font = fontForStyle(font, bodyFontSize, run.style)
        context.globalAlpha = run.style.opacity
          ? Number(run.style.opacity)
          : 1
        const runWidth = context.measureText(run.text).width
        if (run.style.backgroundColor) {
          context.fillStyle = run.style.backgroundColor
          context.fillRect(x, y, runWidth, lineHeightPixels)
        }
        context.fillStyle = run.style.color ?? color
        context.fillText(run.text, x, y, width - paddingPixels - x)
        if (run.style.textDecorationLine?.includes('underline')) {
          context.fillRect(x, y + bodyFontSize + 2, runWidth, 1.5)
        }
        if (run.style.textDecorationLine?.includes('line-through')) {
          context.fillRect(x, y + (bodyFontSize * 0.55), runWidth, 1.5)
        }
        x += runWidth
      }
    }
    context.globalAlpha = 1
    context.shadowBlur = 0
    this.texture.needsUpdate = true
  }

  dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.mesh.geometry.dispose()
    this.material.dispose()
    this.texture.dispose()
    this.canvas.width = 1
    this.canvas.height = 1
  }
}

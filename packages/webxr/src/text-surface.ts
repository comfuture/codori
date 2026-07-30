import {
  CanvasTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
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
  MAX_PANEL_OUTPUT_CHARS,
  TEXT_TEXTURE_ANISOTROPY
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
  bodyFontSizePixels?: number
  titleFontSizePixels?: number
  opacity?: number
  glow?: boolean
  radiusPixels?: number
}

export type TextSurfaceIcon = 'close' | 'drag'

export type TextSurfaceContent = {
  title?: string
  status?: string
  body: string
  scrollLine?: number
  ansi?: boolean
  active?: boolean
  icon?: TextSurfaceIcon
}

export type TextSurfaceSize = {
  widthMeters: number
  heightMeters: number
  widthPixels?: number
  heightPixels?: number
}

const clampCanvasSize = (value: number) =>
  Math.max(64, Math.min(MAX_PANEL_CANVAS_EDGE, Math.round(value)))

const defaultSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'word' })
  : null
const graphemeSegmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  : null

type TextMeasurer = Pick<CanvasRenderingContext2D, 'measureText'>

export const truncateCanvasText = (
  context: TextMeasurer,
  text: string,
  maximumWidth: number
) => {
  if (maximumWidth <= 0) {
    return ''
  }
  if (context.measureText(text).width <= maximumWidth) {
    return text
  }
  const ellipsis = '…'
  if (context.measureText(ellipsis).width > maximumWidth) {
    return ''
  }
  const graphemes = graphemeSegmenter
    ? [...graphemeSegmenter.segment(text)].map(segment => segment.segment)
    : [...text]
  let low = 0
  let high = graphemes.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = graphemes.slice(0, middle).join('') + ellipsis
    if (context.measureText(candidate).width <= maximumWidth) {
      low = middle
    } else {
      high = middle - 1
    }
  }
  return graphemes.slice(0, low).join('').trimEnd() + ellipsis
}

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

type ConfigurableTextTexture = Pick<
  CanvasTexture,
  | 'anisotropy'
  | 'colorSpace'
  | 'generateMipmaps'
  | 'magFilter'
  | 'minFilter'
>

export const configureCanvasTextTexture = (
  texture: ConfigurableTextTexture
) => {
  texture.colorSpace = SRGBColorSpace
  texture.generateMipmaps = true
  texture.minFilter = LinearMipmapLinearFilter
  texture.magFilter = LinearFilter
  texture.anisotropy = TEXT_TEXTURE_ANISOTROPY
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
      bodyFontSizePixels: 27,
      titleFontSizePixels: 32,
      opacity: 1,
      glow: false,
      radiusPixels: 42,
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
    configureCanvasTextTexture(this.texture)
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

  resize(size: TextSurfaceSize) {
    if (this.disposed) {
      return
    }
    const widthPixels = clampCanvasSize(
      size.widthPixels ?? this.canvas.width
    )
    const heightPixels = clampCanvasSize(
      size.heightPixels ?? this.canvas.height
    )
    const pixelSizeChanged = (
      this.canvas.width !== widthPixels
      || this.canvas.height !== heightPixels
    )
    const meterSizeChanged = (
      this.options.widthMeters !== size.widthMeters
      || this.options.heightMeters !== size.heightMeters
    )
    if (!pixelSizeChanged && !meterSizeChanged) {
      return
    }
    this.options.widthMeters = size.widthMeters
    this.options.heightMeters = size.heightMeters
    this.options.widthPixels = widthPixels
    this.options.heightPixels = heightPixels
    if (pixelSizeChanged) {
      this.canvas.width = widthPixels
      this.canvas.height = heightPixels
    }
    if (meterSizeChanged) {
      this.mesh.geometry.dispose()
      this.mesh.geometry = new PlaneGeometry(
        size.widthMeters,
        size.heightMeters
      )
    }
    this.texture.needsUpdate = true
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
      bodyFontSizePixels,
      titleFontSizePixels,
      glow,
      radiusPixels
    } = this.options
    const active = content.active === true
    const context = this.context
    context.clearRect(0, 0, width, height)
    roundedRect(
      context,
      3,
      3,
      width - 6,
      height - 6,
      radiusPixels
    )
    context.fillStyle = background
    context.fill()
    const strokeColor = active ? '#8cecff' : border
    context.lineWidth = active ? 10 : 4
    context.strokeStyle = strokeColor
    if (glow || active) {
      context.shadowBlur = active ? 44 : 22
      context.shadowColor = strokeColor
    }
    context.stroke()
    context.shadowBlur = 0

    if (content.icon) {
      context.fillStyle = color
      context.strokeStyle = color
      context.lineCap = 'round'
      context.lineJoin = 'round'
      if (glow) {
        context.shadowBlur = 14
        context.shadowColor = color
      }
      const centerX = width / 2
      const centerY = height / 2
      if (content.icon === 'close') {
        const extent = Math.min(width, height) * 0.18
        context.lineWidth = Math.max(8, Math.min(width, height) * 0.07)
        context.beginPath()
        context.moveTo(centerX - extent, centerY - extent)
        context.lineTo(centerX + extent, centerY + extent)
        context.moveTo(centerX + extent, centerY - extent)
        context.lineTo(centerX - extent, centerY + extent)
        context.stroke()
      } else {
        const xOffset = Math.min(width, height) * 0.105
        const yOffset = Math.min(width, height) * 0.14
        const radius = Math.min(width, height) * 0.033
        for (const x of [centerX - xOffset, centerX + xOffset]) {
          for (const y of [
            centerY - yOffset,
            centerY,
            centerY + yOffset
          ]) {
            context.beginPath()
            context.arc(x, y, radius, 0, Math.PI * 2)
            context.fill()
          }
        }
      }
      context.shadowBlur = 0
      this.texture.needsUpdate = true
      return
    }

    let bodyTop = paddingPixels
    if (content.title || content.status) {
      context.font = `600 ${titleFontSizePixels}px ${font}`
      context.fillStyle = color
      context.textBaseline = 'top'
      const statusWidth = content.status ? 210 : 0
      const titleWidth = Math.max(
        0,
        width - (paddingPixels * 2) - statusWidth - (
          content.status ? 10 : 0
        )
      )
      const title = truncateCanvasText(
        context,
        content.title ?? '',
        titleWidth
      )
      context.save()
      context.beginPath()
      context.rect(
        paddingPixels,
        paddingPixels,
        titleWidth,
        titleFontSizePixels + 8
      )
      context.clip()
      context.fillText(title, paddingPixels, paddingPixels)
      context.restore()
      if (content.status) {
        const status = truncateCanvasText(
          context,
          content.status,
          statusWidth
        )
        context.textAlign = 'right'
        context.fillStyle = border
        context.save()
        context.beginPath()
        context.rect(
          width - paddingPixels - statusWidth,
          paddingPixels,
          statusWidth,
          titleFontSizePixels + 8
        )
        context.clip()
        context.fillText(status, width - paddingPixels, paddingPixels)
        context.restore()
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

    const bodyFontSize = bodyFontSizePixels
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

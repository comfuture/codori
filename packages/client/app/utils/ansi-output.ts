export type AnsiOutputStyle = {
  color?: string
  backgroundColor?: string
  fontWeight?: string
  fontStyle?: string
  textDecorationLine?: string
  opacity?: string
}

export type AnsiOutputSegment = {
  text: string
  style: AnsiOutputStyle
}

type AnsiState = {
  foregroundColor?: string
  backgroundColor?: string
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  inverse: boolean
  strike: boolean
}

const ESCAPE_SEQUENCE = '\\u001B'
const BELL_SEQUENCE = '\\u0007'

const CSI_PATTERN = new RegExp(`${ESCAPE_SEQUENCE}\\[([0-?]*)([ -/]*)([@-~])`, 'gu')
const OSC_PATTERN = new RegExp(`${ESCAPE_SEQUENCE}\\][^${BELL_SEQUENCE}${ESCAPE_SEQUENCE}]*(?:${BELL_SEQUENCE}|${ESCAPE_SEQUENCE}\\\\)`, 'gu')
const UNSUPPORTED_ANSI_PATTERN = new RegExp(`${ESCAPE_SEQUENCE}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`, 'gu')

const standardForegroundColors = [
  '#111827',
  '#dc2626',
  '#16a34a',
  '#ca8a04',
  '#2563eb',
  '#c026d3',
  '#0891b2',
  '#e5e7eb'
]

const brightForegroundColors = [
  '#6b7280',
  '#ef4444',
  '#22c55e',
  '#eab308',
  '#3b82f6',
  '#d946ef',
  '#06b6d4',
  '#f9fafb'
]

const standardBackgroundColors = [
  '#111827',
  '#7f1d1d',
  '#14532d',
  '#713f12',
  '#1e3a8a',
  '#701a75',
  '#164e63',
  '#f3f4f6'
]

const brightBackgroundColors = [
  '#374151',
  '#991b1b',
  '#166534',
  '#854d0e',
  '#1d4ed8',
  '#86198f',
  '#0e7490',
  '#ffffff'
]

const createInitialState = (): AnsiState => ({
  foregroundColor: undefined,
  backgroundColor: undefined,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
  strike: false
})

const styleFromState = (state: AnsiState): AnsiOutputStyle => {
  const textDecorationLine = [
    state.underline ? 'underline' : null,
    state.strike ? 'line-through' : null
  ].filter((value): value is string => Boolean(value)).join(' ')

  return {
    ...(state.inverse && state.backgroundColor ? { color: state.backgroundColor } : {}),
    ...(!state.inverse && state.foregroundColor ? { color: state.foregroundColor } : {}),
    ...(state.inverse && state.foregroundColor ? { backgroundColor: state.foregroundColor } : {}),
    ...(!state.inverse && state.backgroundColor ? { backgroundColor: state.backgroundColor } : {}),
    ...(state.bold ? { fontWeight: '700' } : {}),
    ...(state.italic ? { fontStyle: 'italic' } : {}),
    ...(textDecorationLine ? { textDecorationLine } : {}),
    ...(state.dim ? { opacity: '0.72' } : {})
  }
}

const styleKey = (style: AnsiOutputStyle) =>
  [
    style.color ?? '',
    style.backgroundColor ?? '',
    style.fontWeight ?? '',
    style.fontStyle ?? '',
    style.textDecorationLine ?? '',
    style.opacity ?? ''
  ].join('|')

const stripUnsupportedAnsi = (text: string) =>
  text.replace(OSC_PATTERN, '').replace(UNSUPPORTED_ANSI_PATTERN, '')

const appendSegment = (
  segments: AnsiOutputSegment[],
  text: string,
  state: AnsiState
) => {
  const cleanText = stripUnsupportedAnsi(text)
  if (!cleanText) {
    return
  }

  const style = styleFromState(state)
  const previous = segments[segments.length - 1]
  if (previous && styleKey(previous.style) === styleKey(style)) {
    previous.text += cleanText
    return
  }

  segments.push({
    text: cleanText,
    style
  })
}

const parseSgrCodes = (params: string) => {
  if (!params) {
    return [0]
  }

  return params
    .replace(/:/gu, ';')
    .split(';')
    .map(param => param === '' ? 0 : Number(param))
    .filter(code => Number.isFinite(code))
}

const rgbColor = (red: number, green: number, blue: number) =>
  `rgb(${red}, ${green}, ${blue})`

const paletteColor = (palette: readonly string[], index: number) =>
  palette[index] ?? null

const ansi256Color = (value: number) => {
  if (value < 0 || value > 255) {
    return null
  }

  if (value < 8) {
    return paletteColor(standardForegroundColors, value)
  }

  if (value < 16) {
    return paletteColor(brightForegroundColors, value - 8)
  }

  if (value >= 232) {
    const level = 8 + ((value - 232) * 10)
    return rgbColor(level, level, level)
  }

  const offset = value - 16
  const red = Math.floor(offset / 36)
  const green = Math.floor((offset % 36) / 6)
  const blue = offset % 6
  const channel = (component: number) => component === 0 ? 0 : 55 + (component * 40)
  return rgbColor(channel(red), channel(green), channel(blue))
}

const readExtendedColor = (codes: number[], index: number) => {
  const mode = codes[index + 1]
  if (mode === 5) {
    const value = codes[index + 2]
    if (value == null) {
      return {
        color: null,
        nextIndex: index
      }
    }

    return {
      color: ansi256Color(value),
      nextIndex: index + 2
    }
  }

  if (mode === 2) {
    const red = codes[index + 2]
    const green = codes[index + 3]
    const blue = codes[index + 4]
    if (
      red != null && red >= 0 && red <= 255
      && green != null && green >= 0 && green <= 255
      && blue != null && blue >= 0 && blue <= 255
    ) {
      return {
        color: rgbColor(red, green, blue),
        nextIndex: index + 4
      }
    }
  }

  return {
    color: null,
    nextIndex: index
  }
}

const applySgrCodes = (state: AnsiState, codes: number[]) => {
  for (let index = 0; index < codes.length; index += 1) {
    const code = codes[index]
    if (code == null) {
      continue
    }

    if (code === 0) {
      Object.assign(state, createInitialState())
      continue
    }

    if (code === 1) {
      state.bold = true
      continue
    }
    if (code === 2) {
      state.dim = true
      continue
    }
    if (code === 3) {
      state.italic = true
      continue
    }
    if (code === 4) {
      state.underline = true
      continue
    }
    if (code === 7) {
      state.inverse = true
      continue
    }
    if (code === 9) {
      state.strike = true
      continue
    }
    if (code === 22) {
      state.bold = false
      state.dim = false
      continue
    }
    if (code === 23) {
      state.italic = false
      continue
    }
    if (code === 24) {
      state.underline = false
      continue
    }
    if (code === 27) {
      state.inverse = false
      continue
    }
    if (code === 29) {
      state.strike = false
      continue
    }
    if (code === 39) {
      state.foregroundColor = undefined
      continue
    }
    if (code === 49) {
      state.backgroundColor = undefined
      continue
    }
    if (code >= 30 && code <= 37) {
      state.foregroundColor = paletteColor(standardForegroundColors, code - 30) ?? state.foregroundColor
      continue
    }
    if (code >= 90 && code <= 97) {
      state.foregroundColor = paletteColor(brightForegroundColors, code - 90) ?? state.foregroundColor
      continue
    }
    if (code >= 40 && code <= 47) {
      state.backgroundColor = paletteColor(standardBackgroundColors, code - 40) ?? state.backgroundColor
      continue
    }
    if (code >= 100 && code <= 107) {
      state.backgroundColor = paletteColor(brightBackgroundColors, code - 100) ?? state.backgroundColor
      continue
    }
    if (code === 38 || code === 48) {
      const { color, nextIndex } = readExtendedColor(codes, index)
      if (color) {
        if (code === 38) {
          state.foregroundColor = color
        } else {
          state.backgroundColor = color
        }
      }
      index = nextIndex
    }
  }
}

export const parseAnsiOutput = (output: string): AnsiOutputSegment[] => {
  const segments: AnsiOutputSegment[] = []
  const state = createInitialState()
  const text = output.replace(OSC_PATTERN, '')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = CSI_PATTERN.exec(text)) !== null) {
    appendSegment(segments, text.slice(lastIndex, match.index), state)

    const params = match[1] ?? ''
    const intermediate = match[2] ?? ''
    const command = match[3] ?? ''
    if (command === 'm' && !intermediate) {
      applySgrCodes(state, parseSgrCodes(params))
    }

    lastIndex = match.index + match[0].length
  }

  appendSegment(segments, text.slice(lastIndex), state)
  return segments
}

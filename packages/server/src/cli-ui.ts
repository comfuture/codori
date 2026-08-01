import pc from 'picocolors'

/**
 * Terminal presentation layer for the Codori CLI.
 *
 * Every color, symbol, and spinner decision is resolved from the target stream
 * rather than from `process.stdout`, because `runCli` accepts an injected
 * stream and tests assert plain text. `--json` output must never pass through
 * this module: JSON callers write directly so no ANSI byte or spinner frame can
 * corrupt a parseable payload.
 */

export type CliUiOptions = {
  stream?: NodeJS.WritableStream
  env?: NodeJS.ProcessEnv
  /** Forces plain output regardless of stream capability, e.g. for `--json`. */
  plain?: boolean
}

type TtyLikeStream = NodeJS.WritableStream & {
  isTTY?: boolean
  columns?: number
}

const isTtyStream = (stream: NodeJS.WritableStream) =>
  (stream as TtyLikeStream).isTTY === true

/**
 * Resolves color support from the target stream and the standard environment
 * overrides. `NO_COLOR` always wins so piped and CI output stays clean, and
 * `FORCE_COLOR` allows deliberate colored capture through a pipe.
 */
export const resolveColorSupport = (
  stream: NodeJS.WritableStream,
  env: NodeJS.ProcessEnv = process.env
) => {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') {
    return false
  }
  if (env.TERM === 'dumb') {
    return false
  }
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '' && env.FORCE_COLOR !== '0') {
    return true
  }
  return isTtyStream(stream)
}

/**
 * Unicode symbols are used only when the terminal is likely to render them.
 * A Windows console without a UTF-8 hint falls back to ASCII so a status line
 * never degrades into replacement characters.
 */
export const resolveUnicodeSupport = (
  env: NodeJS.ProcessEnv,
  platform: string = process.platform
) => {
  if (platform !== 'win32') {
    return true
  }
  if (env.WT_SESSION || env.TERM_PROGRAM === 'vscode') {
    return true
  }
  return /UTF-?8$/i.test(env.LANG ?? '') || /UTF-?8$/i.test(env.LC_ALL ?? '')
}

export type CliUi = {
  readonly color: boolean
  readonly interactive: boolean
  /** Emits a raw line with no styling applied. */
  line: (text?: string) => void
  /** A bright section heading used by the help body and summaries. */
  heading: (text: string) => void
  /** Dimmed supporting text. */
  muted: (text: string) => void
  success: (text: string) => void
  warn: (text: string) => void
  info: (text: string) => void
  /** Aligned `label  value` rows for a compact summary block. */
  keyValues: (rows: [string, string][], indent?: string) => void
  /** Aligned table with a dimmed header row. */
  table: (columns: string[], rows: string[][], indent?: string) => void
  /** Runs a task behind a spinner, falling back to plain lines when inert. */
  task: <T>(label: string, run: () => Promise<T>, doneLabel?: (value: T) => string) => Promise<T>
  /** Colorizes a runtime state word such as `running` or `stopped`. */
  statusLabel: (status: string) => string
  bold: (text: string) => string
  dim: (text: string) => string
  accent: (text: string) => string
  url: (text: string) => string
}

// eslint-disable-next-line no-control-regex
const ANSI_PATTERN = /\u001B\[[0-9;]*m/g

const stripAnsi = (value: string) => value.replace(ANSI_PATTERN, '')

/** Pads to a visible width, ignoring ANSI escapes in the measured value. */
const padVisible = (value: string, width: number) => {
  const visibleLength = stripAnsi(value).length
  return visibleLength >= width ? value : `${value}${' '.repeat(width - visibleLength)}`
}

const RUNNING_STATES = new Set(['running', 'started', 'ready', 'active', 'reused'])
const STOPPED_STATES = new Set(['stopped', 'idle', 'inactive', 'not-installed'])
const FAILED_STATES = new Set(['error', 'failed', 'crashed', 'unknown'])

export const createCliUi = (options: CliUiOptions = {}): CliUi => {
  const stream = options.stream ?? process.stdout
  const env = options.env ?? process.env
  const plain = options.plain ?? false
  const color = !plain && resolveColorSupport(stream, env)
  const unicode = resolveUnicodeSupport(env)
  // A spinner is animated only on a real TTY; anywhere else it would emit
  // cursor-control noise into a log file or a captured test stream.
  const interactive = !plain && isTtyStream(stream) && !env.CI

  // `createColors` is used instead of the default export because the default
  // decides once from the real `process.stdout`. The CLI writes to an injected
  // stream, so color must be resolved from that stream instead.
  const colors = pc.createColors(color)
  const { bold, dim, green, yellow, red } = colors
  const accent = colors.cyan
  const urlPaint = (value: string) => colors.underline(colors.cyan(value))

  const symbols = unicode
    ? { success: '✔', warn: '▲', info: '•' }
    : { success: 'v', warn: '!', info: '-' }

  const line = (text = '') => {
    stream.write(`${text}\n`)
  }

  const statusLabel = (status: string) => {
    const normalized = status.toLowerCase()
    if (RUNNING_STATES.has(normalized)) {
      return green(status)
    }
    if (FAILED_STATES.has(normalized)) {
      return red(status)
    }
    if (STOPPED_STATES.has(normalized)) {
      return dim(status)
    }
    return yellow(status)
  }

  const keyValues = (rows: [string, string][], indent = '  ') => {
    const width = rows.reduce((max, [label]) => Math.max(max, label.length), 0)
    for (const [label, value] of rows) {
      line(`${indent}${dim(padVisible(label, width))}  ${value}`)
    }
  }

  const table = (columns: string[], rows: string[][], indent = '  ') => {
    const widths = columns.map((column, index) => rows.reduce(
      (max, row) => Math.max(max, stripAnsi(row[index] ?? '').length),
      stripAnsi(column).length
    ))

    const header = columns
      .map((column, index) => dim(padVisible(column.toUpperCase(), widths[index] ?? 0)))
      .join('  ')
    line(`${indent}${header}`.trimEnd())

    for (const row of rows) {
      const cells = columns
        .map((_, index) => padVisible(row[index] ?? '', widths[index] ?? 0))
        .join('  ')
      line(`${indent}${cells}`.trimEnd())
    }
  }

  const task = async <T>(
    label: string,
    run: () => Promise<T>,
    doneLabel?: (value: T) => string
  ): Promise<T> => {
    if (!interactive) {
      const value = await run()
      line(`${green(symbols.success)} ${doneLabel ? doneLabel(value) : label}`)
      return value
    }

    // Imported lazily so a non-interactive run never pays for the spinner
    // dependency graph, including its stdin discarder and cursor handling.
    const { default: ora } = await import('ora')
    const spinner = ora({
      text: label,
      stream: stream as NodeJS.WriteStream,
      isEnabled: true
    }).start()

    try {
      const value = await run()
      spinner.succeed(doneLabel ? doneLabel(value) : label)
      return value
    } catch (error) {
      spinner.fail(label)
      throw error
    }
  }

  return {
    color,
    interactive,
    line,
    heading: (text: string) => line(bold(text)),
    muted: (text: string) => line(dim(text)),
    success: (text: string) => line(`${green(symbols.success)} ${text}`),
    warn: (text: string) => line(`${yellow(symbols.warn)} ${text}`),
    info: (text: string) => line(`${accent(symbols.info)} ${text}`),
    keyValues,
    table,
    task,
    statusLabel,
    bold,
    dim,
    accent,
    url: urlPaint
  }
}

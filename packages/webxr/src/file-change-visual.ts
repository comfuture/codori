import { PANEL_ANIMATION_MS } from './config'

export type FilePanelChangeKind = 'add' | 'delete' | 'update'

export type FilePanelChange = {
  sourceId: string
  path: string
  kind: FilePanelChangeKind
  diff: string
}

type PatchLineKind = 'context' | 'removed' | 'added'

type PatchLine = {
  kind: PatchLineKind
  text: string
  oldLine: number | null
  newLine: number | null
}

const ANSI_RESET = '\u001B[0m'
const ANSI_REMOVED = '\u001B[91;2;9m'
const ANSI_ADDED = '\u001B[96;1m'
const DEFAULT_VISIBLE_LINES = 16

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

const parseHunkStart = (line: string) => {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line)
  return match
    ? {
        oldLine: Number(match[1]),
        newLine: Number(match[2])
      }
    : null
}

export const parseFilePatchLines = (diff: string): PatchLine[] => {
  const lines: PatchLine[] = []
  let oldLine: number | null = null
  let newLine: number | null = null
  for (const sourceLine of diff.replaceAll('\r\n', '\n').split('\n')) {
    const hunk = parseHunkStart(sourceLine)
    if (hunk) {
      oldLine = hunk.oldLine
      newLine = hunk.newLine
      continue
    }
    if (
      sourceLine.startsWith('diff --git ')
      || sourceLine.startsWith('index ')
      || sourceLine.startsWith('--- ')
      || sourceLine.startsWith('+++ ')
      || sourceLine.startsWith('\\ No newline at end of file')
    ) {
      continue
    }
    if (sourceLine.startsWith('-')) {
      lines.push({
        kind: 'removed',
        text: sourceLine.slice(1),
        oldLine,
        newLine: null
      })
      if (oldLine !== null) {
        oldLine += 1
      }
      continue
    }
    if (sourceLine.startsWith('+')) {
      lines.push({
        kind: 'added',
        text: sourceLine.slice(1),
        oldLine: null,
        newLine
      })
      if (newLine !== null) {
        newLine += 1
      }
      continue
    }
    const text = sourceLine.startsWith(' ')
      ? sourceLine.slice(1)
      : sourceLine
    if (!text && oldLine === null && newLine === null) {
      continue
    }
    lines.push({
      kind: 'context',
      text,
      oldLine,
      newLine
    })
    if (oldLine !== null) {
      oldLine += 1
    }
    if (newLine !== null) {
      newLine += 1
    }
  }
  return lines
}

const lineNumber = (line: PatchLine) => line.newLine ?? line.oldLine

const formatLine = (
  line: PatchLine,
  state: 'settled' | 'removed' | 'added'
) => {
  const number = lineNumber(line)
  const prefix = number === null
    ? '     '
    : `${String(number).padStart(4, ' ')} `
  const text = `${prefix}${line.text}`
  if (state === 'removed') {
    return `${ANSI_REMOVED}${text}${ANSI_RESET}`
  }
  if (state === 'added') {
    return `${ANSI_ADDED}${text}${ANSI_RESET}`
  }
  return text
}

const boundedTail = (
  lines: PatchLine[],
  maximumLines: number
) => lines.slice(-Math.max(1, Math.floor(maximumLines)))

export const resolveFileChangeFrame = (input: {
  change: FilePanelChange
  elapsedMs: number
  maximumLines?: number
}) => {
  const maximumLines = input.maximumLines ?? DEFAULT_VISIBLE_LINES
  const parsed = parseFilePatchLines(input.change.diff)
  if (parsed.length === 0) {
    return input.change.kind === 'delete'
      ? '[file deleted]'
      : 'Waiting for file content…'
  }

  const progress = clamp01(input.elapsedMs / PANEL_ANIMATION_MS)
  const removed = parsed.filter(line => line.kind === 'removed')
  const added = parsed.filter(line => line.kind === 'added')
  const removalProgress = input.change.kind === 'add'
    ? 1
    : clamp01(progress / 0.45)
  const insertionProgress = input.change.kind === 'delete'
    ? 0
    : clamp01(
        input.change.kind === 'add'
          ? progress
          : (progress - 0.45) / 0.45
      )
  const remainingRemoved = Math.ceil(
    removed.length * (1 - removalProgress)
  )
  const visibleAdded = progress >= 1
    ? added.length
    : Math.floor(added.length * insertionProgress)
  let removedIndex = 0
  let addedIndex = 0
  const frame = parsed.filter((line) => {
    if (line.kind === 'removed') {
      const visible = removedIndex < remainingRemoved
      removedIndex += 1
      return visible
    }
    if (line.kind === 'added') {
      const visible = addedIndex < visibleAdded
      addedIndex += 1
      return visible
    }
    return true
  })

  if (input.change.kind === 'delete' && frame.length === 0) {
    return '[file deleted]'
  }
  if (frame.length === 0) {
    return input.change.kind === 'add'
      ? 'Creating file…'
      : 'Updating file…'
  }

  return boundedTail(frame, maximumLines)
    .map(line => formatLine(
      line,
      progress >= 1 || line.kind === 'context'
        ? 'settled'
        : line.kind
    ))
    .join('\n')
}

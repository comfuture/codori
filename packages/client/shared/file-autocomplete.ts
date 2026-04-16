export type ActiveFileAutocompleteMatch = {
  start: number
  end: number
  raw: string
  query: string
}

export type NormalizedFuzzyFileSearchMatch = {
  path: string
  root: string
  fileName: string
  matchType: 'file' | 'directory'
  score: number
  indices: number[] | null
}

export type FileAutocompletePathSegment = {
  text: string
  isMatch: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)

const normalizeMatch = (value: unknown): NormalizedFuzzyFileSearchMatch | null => {
  if (!isRecord(value)) {
    return null
  }

  const path = value.path
  const root = value.root
  const fileName = value.file_name ?? value.fileName
  const matchType = value.match_type ?? value.matchType
  const score = value.score
  const indices = value.indices

  if (
    typeof path !== 'string'
    || typeof root !== 'string'
    || typeof fileName !== 'string'
    || (matchType !== 'file' && matchType !== 'directory')
    || typeof score !== 'number'
  ) {
    return null
  }

  return {
    path,
    root,
    fileName,
    matchType,
    score,
    indices: Array.isArray(indices) ? indices.filter(index => typeof index === 'number') : null
  }
}

export const normalizeFuzzyFileSearchMatches = (value: unknown): NormalizedFuzzyFileSearchMatch[] => {
  if (!isRecord(value) || !Array.isArray(value.files)) {
    return []
  }

  return value.files
    .map(normalizeMatch)
    .filter((match): match is NormalizedFuzzyFileSearchMatch => match !== null)
}

export const findActiveFileAutocompleteMatch = (
  input: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
): ActiveFileAutocompleteMatch | null => {
  if (selectionStart == null || selectionEnd == null || selectionStart !== selectionEnd) {
    return null
  }

  const caret = selectionStart
  let start = caret
  while (start > 0 && !/\s/u.test(input[start - 1] ?? '')) {
    start -= 1
  }

  let end = caret
  while (end < input.length && !/\s/u.test(input[end] ?? '')) {
    end += 1
  }

  const raw = input.slice(start, end)

  if (!raw.startsWith('@')) {
    return null
  }

  return {
    start,
    end,
    raw,
    query: raw.slice(1)
  }
}

export const normalizeFileAutocompleteQuery = (query: string) =>
  query.trim().replace(/^\/+/, '')

const toAbsoluteAutocompletePath = (match: Pick<NormalizedFuzzyFileSearchMatch, 'root' | 'path'>) => {
  const normalizedRoot = match.root.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedPath = match.path.replace(/\\/g, '/').replace(/^\/+/, '')
  return normalizedRoot
    ? `${normalizedRoot}/${normalizedPath}`
    : `/${normalizedPath}`
}

export const toFileAutocompleteHandle = (
  match: Pick<NormalizedFuzzyFileSearchMatch, 'root' | 'path' | 'fileName'>
) => {
  const absolutePath = toAbsoluteAutocompletePath(match)
  return `[${match.fileName}](${encodeURI(absolutePath)})`
}

export const buildFileAutocompletePathSegments = (
  match: Pick<NormalizedFuzzyFileSearchMatch, 'path' | 'indices'>
): FileAutocompletePathSegment[] => {
  const highlightedIndices = new Set(
    (match.indices ?? [])
      .filter(index => Number.isInteger(index) && index >= 0 && index < match.path.length)
  )

  const characters = match.path.split('')
  const segments: FileAutocompletePathSegment[] = [{
    text: '/',
    isMatch: false
  }]

  for (const [index, character] of characters.entries()) {
    const isMatch = highlightedIndices.has(index)
    const previousSegment = segments[segments.length - 1]
    if (previousSegment && previousSegment.isMatch === isMatch) {
      previousSegment.text += character
      continue
    }

    segments.push({
      text: character,
      isMatch
    })
  }

  return segments
}

export const replaceActiveFileAutocompleteMatch = (
  input: string,
  match: Pick<ActiveFileAutocompleteMatch, 'start' | 'end'>,
  replacement: string
) => {
  const suffix = input.slice(match.end)
  const trailingSpace = /^\s/u.test(suffix) || suffix.length === 0 ? '' : ' '
  const nextValue = `${input.slice(0, match.start)}${replacement}${trailingSpace}${suffix}`
  const nextCaret = match.start + replacement.length + trailingSpace.length

  return {
    value: nextValue,
    caret: nextCaret
  }
}

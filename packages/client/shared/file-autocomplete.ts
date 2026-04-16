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

export const toFileAutocompleteInsertion = (match: Pick<NormalizedFuzzyFileSearchMatch, 'path' | 'matchType'>) => {
  const normalizedPath = `/${match.path.replace(/^\/+/, '')}`
  if (match.matchType === 'directory') {
    return `${normalizedPath.replace(/\/?$/, '/')}`
  }

  return normalizedPath
}

export const replaceActiveFileAutocompleteMatch = (
  input: string,
  match: Pick<ActiveFileAutocompleteMatch, 'start' | 'end'>,
  replacement: string
) => {
  const needsQuotes = /\s/u.test(replacement) && !replacement.includes('"')
  const inserted = needsQuotes ? `"${replacement}"` : replacement
  const suffix = input.slice(match.end)
  const trailingSpace = inserted.endsWith('/') || /^\s/u.test(suffix) || suffix.length === 0 ? '' : ' '
  const nextValue = `${input.slice(0, match.start)}${inserted}${trailingSpace}${suffix}`
  const nextCaret = match.start + inserted.length + trailingSpace.length

  return {
    value: nextValue,
    caret: nextCaret
  }
}

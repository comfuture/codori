export type ActiveSkillAutocompleteMatch = {
  start: number
  end: number
  raw: string
  query: string
}

export type SkillAutocompleteScope = 'user' | 'repo' | 'system' | 'admin'

export type SkillAutocompleteEntry = {
  name: string
  description: string
  enabled: boolean
  path: string
  scope: SkillAutocompleteScope
  shortDescription: string | null
  displayName: string | null
  brandColor: string | null
  iconSmall: string | null
  iconLarge: string | null
}

export type SkillAutocompleteError = {
  message: string
  path: string
}

export type SkillsListEntry = {
  cwd: string
  errors: SkillAutocompleteError[]
  skills: SkillAutocompleteEntry[]
}

export type SkillAutocompleteSelection = {
  start: number
  end: number
  name: string
  path: string
}

export type SkillAutocompleteReplacement = {
  value: string
  caret: number
  tokenStart: number
  tokenEnd: number
}

const SKILL_SCOPE_VALUES = new Set<SkillAutocompleteScope>(['user', 'repo', 'system', 'admin'])
const SKILL_TOKEN_PATTERN = /^[a-z0-9][a-z0-9:._/-]*$/i
const SUBMITTED_SKILL_MENTION_PATTERN = /(^|\s)(\$([a-z0-9][a-z0-9:._/-]*))/gi

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)

const normalizeNullableString = (value: unknown) =>
  typeof value === 'string' ? value : null

const normalizeSkillInterface = (value: unknown) => {
  if (!isRecord(value)) {
    return null
  }

  return {
    brandColor: normalizeNullableString(value.brandColor),
    displayName: normalizeNullableString(value.displayName),
    iconLarge: normalizeNullableString(value.iconLarge),
    iconSmall: normalizeNullableString(value.iconSmall),
    shortDescription: normalizeNullableString(value.shortDescription)
  }
}

const normalizeSkillAutocompleteEntry = (value: unknown): SkillAutocompleteEntry | null => {
  if (!isRecord(value)) {
    return null
  }

  const name = value.name
  const description = value.description
  const enabled = value.enabled
  const path = value.path
  const scope = value.scope
  if (
    typeof name !== 'string'
    || typeof description !== 'string'
    || typeof enabled !== 'boolean'
    || typeof path !== 'string'
    || !SKILL_SCOPE_VALUES.has(scope as SkillAutocompleteScope)
  ) {
    return null
  }

  const skillInterface = normalizeSkillInterface(value.interface)
  return {
    name,
    description,
    enabled,
    path,
    scope: scope as SkillAutocompleteScope,
    shortDescription: normalizeNullableString(value.shortDescription) ?? skillInterface?.shortDescription ?? null,
    displayName: skillInterface?.displayName ?? null,
    brandColor: skillInterface?.brandColor ?? null,
    iconSmall: skillInterface?.iconSmall ?? null,
    iconLarge: skillInterface?.iconLarge ?? null
  }
}

const normalizeSkillAutocompleteError = (value: unknown): SkillAutocompleteError | null => {
  if (!isRecord(value)) {
    return null
  }

  const message = value.message
  const path = value.path
  if (typeof message !== 'string' || typeof path !== 'string') {
    return null
  }

  return {
    message,
    path
  }
}

const normalizeSkillsListEntry = (value: unknown): SkillsListEntry | null => {
  if (!isRecord(value)) {
    return null
  }

  const cwd = value.cwd
  if (typeof cwd !== 'string') {
    return null
  }

  const skills = Array.isArray(value.skills)
    ? value.skills
      .map(normalizeSkillAutocompleteEntry)
      .filter((entry): entry is SkillAutocompleteEntry => entry !== null)
    : []

  const errors = Array.isArray(value.errors)
    ? value.errors
      .map(normalizeSkillAutocompleteError)
      .filter((entry): entry is SkillAutocompleteError => entry !== null)
    : []

  return {
    cwd,
    errors,
    skills
  }
}

const buildUniqueSkillPathMap = (skills: SkillAutocompleteEntry[]) => {
  const nextPaths = new Map<string, string | null>()

  for (const skill of skills) {
    if (!skill.enabled) {
      continue
    }

    const key = skill.name.toLowerCase()
    const existing = nextPaths.get(key)
    if (existing == null && nextPaths.has(key)) {
      continue
    }

    if (!nextPaths.has(key)) {
      nextPaths.set(key, skill.path)
      continue
    }

    if (existing !== skill.path) {
      nextPaths.set(key, null)
    }
  }

  return nextPaths
}

export const normalizeSkillsListResponse = (value: unknown): SkillsListEntry[] => {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return []
  }

  return value.data
    .map(normalizeSkillsListEntry)
    .filter((entry): entry is SkillsListEntry => entry !== null)
}

export const findActiveSkillAutocompleteMatch = (
  input: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
): ActiveSkillAutocompleteMatch | null => {
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
  if (!raw.startsWith('$')) {
    return null
  }

  const query = raw.slice(1)
  if (query && !SKILL_TOKEN_PATTERN.test(query)) {
    return null
  }

  return {
    start,
    end,
    raw,
    query
  }
}

export const hasSkillAutocompleteMentions = (input: string) => {
  SUBMITTED_SKILL_MENTION_PATTERN.lastIndex = 0
  return SUBMITTED_SKILL_MENTION_PATTERN.test(input)
}

export const filterSkillAutocompleteEntries = (
  entries: SkillAutocompleteEntry[],
  query: string
) => {
  const normalizedQuery = query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (!entry.enabled) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    return entry.name.toLowerCase().startsWith(normalizedQuery)
      || entry.displayName?.toLowerCase().startsWith(normalizedQuery)
  })
}

export const toSkillAutocompleteCompletion = (entry: Pick<SkillAutocompleteEntry, 'name'>) =>
  `$${entry.name}`

export const replaceActiveSkillAutocompleteMatch = (
  input: string,
  match: Pick<ActiveSkillAutocompleteMatch, 'start' | 'end'>,
  replacement: string
): SkillAutocompleteReplacement => {
  const suffix = input.slice(match.end)
  const trailingSpace = suffix.length === 0 || !/^\s/u.test(suffix) ? ' ' : ''
  const value = `${input.slice(0, match.start)}${replacement}${trailingSpace}${suffix}`

  return {
    value,
    caret: match.start + replacement.length + trailingSpace.length,
    tokenStart: match.start,
    tokenEnd: match.start + replacement.length
  }
}

export const reconcileSkillAutocompleteSelections = (
  previousInput: string,
  nextInput: string,
  selections: SkillAutocompleteSelection[]
) => {
  if (!selections.length || previousInput === nextInput) {
    return selections
  }

  let prefixLength = 0
  const prefixLimit = Math.min(previousInput.length, nextInput.length)
  while (
    prefixLength < prefixLimit
    && previousInput[prefixLength] === nextInput[prefixLength]
  ) {
    prefixLength += 1
  }

  let suffixLength = 0
  const previousRemainder = previousInput.length - prefixLength
  const nextRemainder = nextInput.length - prefixLength
  while (
    suffixLength < previousRemainder
    && suffixLength < nextRemainder
    && previousInput[previousInput.length - 1 - suffixLength] === nextInput[nextInput.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  const previousChangedEnd = previousInput.length - suffixLength
  const nextChangedEnd = nextInput.length - suffixLength
  const delta = nextChangedEnd - previousChangedEnd

  return selections
    .flatMap((selection) => {
      if (selection.end <= prefixLength) {
        return [selection]
      }

      if (selection.start >= previousChangedEnd) {
        const shiftedSelection = {
          ...selection,
          start: selection.start + delta,
          end: selection.end + delta
        }
        return nextInput.slice(shiftedSelection.start, shiftedSelection.end) === `$${shiftedSelection.name}`
          ? [shiftedSelection]
          : []
      }

      return []
    })
    .sort((left, right) => left.start - right.start)
}

export const toSkillMarkdownLink = (input: {
  token: string
  path: string
}) => `[${input.token}](${encodeURI(input.path)})`

const replaceSelectedSkillMentionsWithMarkdownLinks = (
  input: string,
  selections: SkillAutocompleteSelection[]
) => {
  if (!selections.length) {
    return input
  }

  let nextValue = input
  const orderedSelections = [...selections].sort((left, right) => right.start - left.start)
  for (const selection of orderedSelections) {
    const token = nextValue.slice(selection.start, selection.end)
    if (token !== `$${selection.name}`) {
      continue
    }

    nextValue = `${nextValue.slice(0, selection.start)}${toSkillMarkdownLink({
      token,
      path: selection.path
    })}${nextValue.slice(selection.end)}`
  }

  return nextValue
}

const replaceUniqueSkillMentionsWithMarkdownLinks = (
  input: string,
  skills: SkillAutocompleteEntry[]
) => {
  const uniquePaths = buildUniqueSkillPathMap(skills)
  SUBMITTED_SKILL_MENTION_PATTERN.lastIndex = 0

  return input.replace(SUBMITTED_SKILL_MENTION_PATTERN, (match, prefix: string, token: string, name: string) => {
    const path = uniquePaths.get(String(name).toLowerCase())
    if (!path) {
      return match
    }

    return `${prefix}${toSkillMarkdownLink({
      token,
      path
    })}`
  })
}

export const preprocessSkillMentionsForSubmission = (
  input: string,
  selections: SkillAutocompleteSelection[],
  skills: SkillAutocompleteEntry[]
) => {
  const withSelectedMentions = replaceSelectedSkillMentionsWithMarkdownLinks(input, selections)
  return replaceUniqueSkillMentionsWithMarkdownLinks(withSelectedMentions, skills)
}

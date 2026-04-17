import type { SubagentAgentStatus } from './codex-chat'
import type { CodexUserInput } from './codex-rpc'
import { encodeProjectIdSegment } from './codori'
import { resolveApiUrl, shouldUseServerProxy } from './network'

export type ActiveMentionAutocompleteMatch = {
  start: number
  end: number
  raw: string
  query: string
}

export type MentionAutocompleteSelectionKind = 'agent' | 'plugin'

export type MentionAutocompleteSelection = {
  start: number
  end: number
  kind: MentionAutocompleteSelectionKind
  token: string
  name: string
  threadId?: string | null
  path?: string | null
}

export type MentionAutocompleteReplacement = {
  value: string
  caret: number
  tokenStart: number
  tokenEnd: number
}

export type AgentMentionAutocompleteEntry = {
  threadId: string
  name: string
  role: string | null
  status: SubagentAgentStatus
}

export type PluginMentionAutocompleteEntry = {
  id: string
  name: string
  installed: boolean
  enabled: boolean
  marketplaceName: string
  marketplacePath: string
  displayName: string | null
  shortDescription: string | null
  longDescription: string | null
  developerName: string | null
  category: string | null
  brandColor: string | null
  composerIcon: string | null
  logo: string | null
}

export type MentionAutocompleteSubmission = {
  pluginInput: Extract<CodexUserInput, { type: 'mention' }>[]
  agentThreadIds: string[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)

const normalizeNullableString = (value: unknown) =>
  typeof value === 'string' ? value : null

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:[\\/]/i
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/

const getSubsequenceMatchScore = (candidate: string, query: string) => {
  if (!query) {
    return 0
  }

  const prefixIndex = candidate.indexOf(query)
  if (prefixIndex === 0) {
    return 400 - Math.max(0, candidate.length - query.length)
  }

  if (prefixIndex > 0) {
    return 300 - prefixIndex
  }

  let previousIndex = -1
  let gapPenalty = 0
  let startIndex = -1

  for (const character of query) {
    const nextIndex = candidate.indexOf(character, previousIndex + 1)
    if (nextIndex === -1) {
      return null
    }

    if (startIndex === -1) {
      startIndex = nextIndex
    } else {
      gapPenalty += Math.max(0, nextIndex - previousIndex - 1)
    }

    previousIndex = nextIndex
  }

  return 200 - startIndex - gapPenalty
}

const resolveBestScore = (query: string, candidates: Array<string | null | undefined>) => {
  let best = Number.NEGATIVE_INFINITY

  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }

    const score = getSubsequenceMatchScore(candidate.toLowerCase(), query)
    if (score != null && score > best) {
      best = score
    }
  }

  return best
}

export const resolveMentionAutocompleteScore = (
  query: string,
  candidates: Array<string | null | undefined>
) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return 0
  }

  return resolveBestScore(normalizedQuery, candidates)
}

const normalizePluginInterface = (value: unknown) => {
  if (!isRecord(value)) {
    return null
  }

  return {
    brandColor: normalizeNullableString(value.brandColor),
    category: normalizeNullableString(value.category),
    composerIcon: normalizeNullableString(value.composerIcon),
    developerName: normalizeNullableString(value.developerName),
    displayName: normalizeNullableString(value.displayName),
    logo: normalizeNullableString(value.logo),
    longDescription: normalizeNullableString(value.longDescription),
    shortDescription: normalizeNullableString(value.shortDescription)
  }
}

export const normalizePluginListResponse = (value: unknown): PluginMentionAutocompleteEntry[] => {
  if (!isRecord(value) || !Array.isArray(value.marketplaces)) {
    return []
  }

  const entries: PluginMentionAutocompleteEntry[] = []

  for (const marketplace of value.marketplaces) {
    if (!isRecord(marketplace)) {
      continue
    }

    const marketplaceName = marketplace.name
    const marketplacePath = marketplace.path
    if (typeof marketplaceName !== 'string' || typeof marketplacePath !== 'string') {
      continue
    }

    const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : []
    for (const plugin of plugins) {
      if (!isRecord(plugin)) {
        continue
      }

      const id = plugin.id
      const name = plugin.name
      const installed = plugin.installed
      const enabled = plugin.enabled
      if (
        typeof id !== 'string'
        || typeof name !== 'string'
        || typeof installed !== 'boolean'
        || typeof enabled !== 'boolean'
      ) {
        continue
      }

      const pluginInterface = normalizePluginInterface(plugin.interface)
      entries.push({
        id,
        name,
        installed,
        enabled,
        marketplaceName,
        marketplacePath,
        displayName: pluginInterface?.displayName ?? null,
        shortDescription: pluginInterface?.shortDescription ?? null,
        longDescription: pluginInterface?.longDescription ?? null,
        developerName: pluginInterface?.developerName ?? null,
        category: pluginInterface?.category ?? null,
        brandColor: pluginInterface?.brandColor ?? null,
        composerIcon: pluginInterface?.composerIcon ?? null,
        logo: pluginInterface?.logo ?? null
      })
    }
  }

  return entries
}

export const slugifyMentionToken = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

export const toAgentMentionToken = (entry: Pick<AgentMentionAutocompleteEntry, 'name'>) => {
  const token = slugifyMentionToken(entry.name)
  return token ? `@${token}` : '@agent'
}

export const toPluginMentionToken = (
  entry: Pick<PluginMentionAutocompleteEntry, 'name' | 'displayName'>
) => {
  const token = slugifyMentionToken(entry.displayName?.trim() || entry.name)
  return token ? `@${token}` : '@plugin'
}

export const findActiveMentionAutocompleteMatch = (
  input: string,
  selectionStart: number | null | undefined,
  selectionEnd: number | null | undefined
): ActiveMentionAutocompleteMatch | null => {
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

export const replaceActiveMentionAutocompleteMatch = (
  input: string,
  match: Pick<ActiveMentionAutocompleteMatch, 'start' | 'end'>,
  replacement: string
): MentionAutocompleteReplacement => {
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

export const reconcileMentionAutocompleteSelections = (
  previousInput: string,
  nextInput: string,
  selections: MentionAutocompleteSelection[]
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
        return [{
          ...selection,
          start: selection.start + delta,
          end: selection.end + delta
        }]
      }

      return []
    })
    .filter((selection) =>
      selection.start >= 0
      && selection.end > selection.start
      && selection.end <= nextInput.length
      && nextInput.slice(selection.start, selection.end) === selection.token
    )
}

export const stripMentionSelectionsFromText = (
  input: string,
  selections: Pick<MentionAutocompleteSelection, 'start' | 'end'>[]
) => {
  if (!selections.length) {
    return input.trim()
  }

  const orderedSelections = selections
    .slice()
    .sort((left, right) => left.start - right.start)

  let cursor = 0
  let output = ''
  for (const selection of orderedSelections) {
    if (selection.start < cursor) {
      continue
    }

    output += input.slice(cursor, selection.start)
    cursor = selection.end
  }

  output += input.slice(cursor)
  return output
    .replace(/[^\S\r\n]+/gu, ' ')
    .replace(/ *(\r?\n) */gu, '$1')
    .trim()
}

export const buildMentionAutocompleteSubmission = (
  selections: MentionAutocompleteSelection[]
): MentionAutocompleteSubmission => {
  const pluginInput: MentionAutocompleteSubmission['pluginInput'] = []
  const agentThreadIds: string[] = []
  const seenPluginPaths = new Set<string>()
  const seenAgentThreadIds = new Set<string>()

  for (const selection of selections) {
    if (selection.kind === 'plugin' && selection.path) {
      const path = selection.path.trim()
      if (!path || seenPluginPaths.has(path)) {
        continue
      }

      seenPluginPaths.add(path)
      pluginInput.push({
        type: 'mention',
        name: selection.name,
        path
      })
      continue
    }

    if (selection.kind === 'agent' && selection.threadId) {
      const threadId = selection.threadId.trim()
      if (!threadId || seenAgentThreadIds.has(threadId)) {
        continue
      }

      seenAgentThreadIds.add(threadId)
      agentThreadIds.push(threadId)
    }
  }

  return {
    pluginInput,
    agentThreadIds
  }
}

export const resolvePluginMentionIconUrl = (input: {
  projectId: string
  path: string | null | undefined
  configuredBase?: string | null
}) => {
  const path = input.path?.trim()
  if (!path) {
    return null
  }

  if (/^(https?:)?\/\//i.test(path) || path.startsWith('data:')) {
    return path
  }

  if (
    !path.startsWith('/')
    && !WINDOWS_ABSOLUTE_PATH_PATTERN.test(path)
    && !WINDOWS_UNC_PATH_PATTERN.test(path)
  ) {
    return null
  }

  const query = new URLSearchParams({
    path
  })
  const requestPath = `/projects/${encodeProjectIdSegment(input.projectId)}/mentions/icon?${query.toString()}`
  if (shouldUseServerProxy(input.configuredBase)) {
    return `/api/codori${requestPath}`
  }

  return resolveApiUrl(requestPath, input.configuredBase)
}

export const filterAgentMentionEntries = (
  entries: AgentMentionAutocompleteEntry[],
  query: string
) => {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return entries.slice().sort((left, right) => left.name.localeCompare(right.name))
  }

  return entries
    .filter((entry) =>
      resolveMentionAutocompleteScore(normalizedQuery, [
        entry.name,
        entry.role
      ]) > Number.NEGATIVE_INFINITY
    )
    .sort((left, right) => {
      const scoreDelta = resolveMentionAutocompleteScore(normalizedQuery, [right.name, right.role])
        - resolveMentionAutocompleteScore(normalizedQuery, [left.name, left.role])
      if (scoreDelta !== 0) {
        return scoreDelta
      }

      return left.name.localeCompare(right.name)
    })
}

export const filterPluginMentionEntries = (
  entries: PluginMentionAutocompleteEntry[],
  query: string
) => {
  const normalizedQuery = query.trim().toLowerCase()
  const enabledEntries = entries.filter(entry => entry.enabled)
  if (!normalizedQuery) {
    return enabledEntries.sort((left, right) =>
      (Number(right.installed) - Number(left.installed))
      || (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name)
    )
  }

  return enabledEntries
    .filter((entry) =>
      resolveMentionAutocompleteScore(normalizedQuery, [
        entry.displayName,
        entry.name,
        entry.marketplaceName,
        entry.category,
        entry.shortDescription,
        entry.longDescription,
        entry.developerName
      ]) > Number.NEGATIVE_INFINITY
    )
    .sort((left, right) => {
      const scoreDelta = resolveMentionAutocompleteScore(normalizedQuery, [
        right.displayName,
        right.name,
        right.marketplaceName,
        right.category,
        right.shortDescription,
        right.longDescription,
        right.developerName
      ]) - resolveMentionAutocompleteScore(normalizedQuery, [
        left.displayName,
        left.name,
        left.marketplaceName,
        left.category,
        left.shortDescription,
        left.longDescription,
        left.developerName
      ])
      if (scoreDelta !== 0) {
        return scoreDelta
      }

      return (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name)
    })
}

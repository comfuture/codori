import {
  findActiveMentionAutocompleteMatch,
  type MentionAutocompleteSelection
} from './mention-autocomplete'
import {
  findActiveSkillAutocompleteMatch,
  type SkillAutocompleteSelection
} from './skill-autocomplete'

export type ComposerHighlightKind =
  | 'skill-pattern'
  | 'mention-pattern'
  | 'selected-skill'
  | 'selected-plugin'
  | 'link'

export type ComposerHighlightRange = {
  start: number
  end: number
  kind: ComposerHighlightKind
}

const closingBrackets: Record<string, string> = { ')': '(', ']': '[', '}': '{' }

const collectLinkRanges = (text: string): ComposerHighlightRange[] => {
  const ranges: ComposerHighlightRange[] = []
  for (const match of text.matchAll(/(?<![a-z0-9_])https?:\/\//giu)) {
    if ((ranges.at(-1)?.end ?? 0) > match.index) continue
    const brackets: string[] = []
    let end = match.index + match[0].length
    for (; end < text.length; end += 1) {
      const character = text[end]!
      if (/[\s<>"'`]/u.test(character)) break
      const opening = closingBrackets[character]
      if (opening) {
        if (brackets.at(-1) !== opening) break
        brackets.pop()
      } else if ('([{'.includes(character)) {
        brackets.push(character)
      }
    }

    const urlText = text.slice(match.index, end).replace(/[.,!?;:…。，！？、；：]+$/u, '')
    try {
      const url = new URL(urlText)
      if (!url.hostname || !['http:', 'https:'].includes(url.protocol)) continue
    } catch {
      continue
    }
    ranges.push({ start: match.index, end: match.index + urlText.length, kind: 'link' })
  }
  return ranges
}

/** Offsets are UTF-16 indices, matching textarea selection and OpaqueRange. */
export const collectComposerHighlightRanges = (
  text: string,
  skills: readonly SkillAutocompleteSelection[] = [],
  mentions: readonly MentionAutocompleteSelection[] = []
): ComposerHighlightRange[] => {
  const links = collectLinkRanges(text)
  const ranges = [...links]
  const selectedSkills = new Map(skills.map(selection => [`${selection.start}:${selection.end}`, selection]))
  const selectedPlugins = new Map(mentions
    .filter(selection => selection.kind === 'plugin')
    .map(selection => [`${selection.start}:${selection.end}`, selection]))

  for (const token of text.matchAll(/\S+/gu)) {
    const start = token.index
    const end = start + token[0].length
    if (links.some(link => start < link.end && end > link.start)) continue

    const key = `${start}:${end}`
    if (token[0].startsWith('$') && findActiveSkillAutocompleteMatch(text, end, end)) {
      const selected = selectedSkills.get(key)
      ranges.push({
        start,
        end,
        kind: selected && token[0] === `$${selected.name}` ? 'selected-skill' : 'skill-pattern'
      })
    } else if (token[0].startsWith('@') && findActiveMentionAutocompleteMatch(text, end, end)) {
      const selected = selectedPlugins.get(key)
      ranges.push({
        start,
        end,
        kind: selected && token[0] === selected.token ? 'selected-plugin' : 'mention-pattern'
      })
    }
  }
  return ranges.sort((left, right) => left.start - right.start)
}

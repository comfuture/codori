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

const matchesSelectedToken = (
  token: string,
  start: number,
  selection: { end: number },
  selectedToken: string
) => selection.end === start + selectedToken.length
  && token.startsWith(selectedToken)
  // Only punctuation may follow the selected span; token extensions stay patterns.
  && /^[.,!?;:…。，！？、；：)\]}"'`]*$/u.test(token.slice(selectedToken.length))

/** Offsets are UTF-16 indices, matching textarea selection and OpaqueRange. */
export const collectComposerHighlightRanges = (
  text: string,
  skills: readonly SkillAutocompleteSelection[] = [],
  mentions: readonly MentionAutocompleteSelection[] = []
): ComposerHighlightRange[] => {
  const links = collectLinkRanges(text)
  const ranges = [...links]
  const selectedSkills = new Map(skills.map(selection => [selection.start, selection]))
  const selectedPlugins = new Map(mentions
    .filter(selection => selection.kind === 'plugin')
    .map(selection => [selection.start, selection]))

  for (const token of text.matchAll(/\S+/gu)) {
    const start = token.index
    const end = start + token[0].length
    if (links.some(link => start < link.end && end > link.start)) continue

    if (token[0].startsWith('$')) {
      const selected = selectedSkills.get(start)
      const selectedToken = selected ? `$${selected.name}` : ''
      if (selected && matchesSelectedToken(token[0], start, selected, selectedToken)
        && findActiveSkillAutocompleteMatch(selectedToken, selectedToken.length, selectedToken.length)) {
        ranges.push({ start, end: selected.end, kind: 'selected-skill' })
      } else if (findActiveSkillAutocompleteMatch(text, end, end)) {
        ranges.push({ start, end, kind: 'skill-pattern' })
      }
    } else if (token[0].startsWith('@') && findActiveMentionAutocompleteMatch(text, end, end)) {
      const selected = selectedPlugins.get(start)
      if (selected && matchesSelectedToken(token[0], start, selected, selected.token)) {
        ranges.push({ start, end: selected.end, kind: 'selected-plugin' })
      } else {
        ranges.push({ start, end, kind: 'mention-pattern' })
      }
    }
  }
  return ranges.sort((left, right) => left.start - right.start)
}

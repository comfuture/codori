import { describe, expect, it } from 'vitest'
import { collectComposerHighlightRanges } from '../shared/composer-highlight-ranges'
import { reconcileMentionAutocompleteSelections, type MentionAutocompleteSelection } from '../shared/mention-autocomplete'
import { reconcileSkillAutocompleteSelections, type SkillAutocompleteSelection } from '../shared/skill-autocomplete'

const skill = (start: number, name = 'nuxt-ui'): SkillAutocompleteSelection => ({
  start, end: start + name.length + 1, name, path: `/skills/${name}/SKILL.md`
})
const plugin = (start: number, token = '@google-drive'): MentionAutocompleteSelection => ({
  start, end: start + token.length, kind: 'plugin', token, name: 'Google Drive', path: 'plugin://google-drive'
})
const summarize = (text: string, skills: SkillAutocompleteSelection[] = [], mentions: MentionAutocompleteSelection[] = []) =>
  collectComposerHighlightRanges(text, skills, mentions)
    .map(range => [text.slice(range.start, range.end), range.kind])

describe('composer highlight ranges', () => {
  it('colors bare triggers and all whitespace-delimited patterns independently of focus', () => {
    const text = '$ @ $nuxt-ui\n@google-drive $plugin:skill/path mail@example.com word$skill $bad!'
    expect(summarize(text)).toEqual([
      ['$', 'skill-pattern'], ['@', 'mention-pattern'], ['$nuxt-ui', 'skill-pattern'],
      ['@google-drive', 'mention-pattern'], ['$plugin:skill/path', 'skill-pattern']
    ])
  })

  it('adds backgrounds only to explicitly selected occurrences, never agents or files', () => {
    const text = '$nuxt-ui $nuxt-ui @google-drive @google-drive @agent @src/main.ts'
    expect(summarize(text, [skill(0)], [
      plugin(text.lastIndexOf('@google-drive')),
      { ...plugin(text.indexOf('@agent'), '@agent'), kind: 'agent', threadId: 'agent-thread' }
    ])).toEqual([
      ['$nuxt-ui', 'selected-skill'], ['$nuxt-ui', 'skill-pattern'],
      ['@google-drive', 'mention-pattern'], ['@google-drive', 'selected-plugin'],
      ['@agent', 'mention-pattern'], ['@src/main.ts', 'mention-pattern']
    ])
  })

  it.each([',', '.', '!', '?', ';', ':', ')', ']', '}', '…', '。', '！？', '"', "'", '`'])('keeps selected spans when a trailing space becomes %s', (punctuation) => {
    const beforeSkill = '$nuxt-ui '
    const afterSkill = `$nuxt-ui${punctuation}`
    const skills = reconcileSkillAutocompleteSelections(beforeSkill, afterSkill, [skill(0)])
    expect(skills).toEqual([skill(0)])
    expect(collectComposerHighlightRanges(afterSkill, skills)).toEqual([
      { start: 0, end: 8, kind: 'selected-skill' }
    ])

    const beforePlugin = '@google-drive '
    const afterPlugin = `@google-drive${punctuation}`
    const mentions = reconcileMentionAutocompleteSelections(beforePlugin, afterPlugin, [plugin(0)])
    expect(mentions).toEqual([plugin(0)])
    expect(collectComposerHighlightRanges(afterPlugin, [], mentions)).toEqual([
      { start: 0, end: 13, kind: 'selected-plugin' }
    ])
  })

  it('keeps punctuation outside selected spans without promoting manually typed copies', () => {
    const text = '$nuxt-ui, $nuxt-ui, @google-drive! @google-drive!'
    expect(summarize(text, [skill(0)], [plugin(text.indexOf('@google-drive'))])).toEqual([
      ['$nuxt-ui', 'selected-skill'], ['@google-drive', 'selected-plugin'],
      ['@google-drive!', 'mention-pattern']
    ])
  })

  it('uses UTF-16 offsets and the existing selection reconciliation after prefix edits', () => {
    const before = '$nuxt-ui @google-drive'
    const after = `한글 😀 ${before}`
    const skills = reconcileSkillAutocompleteSelections(before, after, [skill(0)])
    const mentions = reconcileMentionAutocompleteSelections(before, after, [plugin(9)])
    expect(collectComposerHighlightRanges(after, skills, mentions)).toEqual([
      { start: 6, end: 14, kind: 'selected-skill' },
      { start: 15, end: 28, kind: 'selected-plugin' }
    ])
  })

  it('rejects stale, mismatched, and partial-token selections', () => {
    expect(summarize('$nuxt-ui-extra @google-drive-extra', [skill(0)], [plugin(15)])).toEqual([
      ['$nuxt-ui-extra', 'skill-pattern'], ['@google-drive-extra', 'mention-pattern']
    ])
    expect(summarize('$nuxt-ui @google-drive', [skill(-1), skill(0, 'different')], [
      { ...plugin(9), token: '@wrong' }
    ])).toEqual([['$nuxt-ui', 'skill-pattern'], ['@google-drive', 'mention-pattern']])
  })

  it.each(['-extra', '.extra', ':extra', '/extra', '_extra', '2'])('rejects selections inside extended tokens ending in %s', (suffix) => {
    const skillText = `$nuxt-ui${suffix}`
    const pluginText = `@google-drive${suffix}`
    expect(summarize(skillText, [skill(0)])).toEqual([[skillText, 'skill-pattern']])
    expect(summarize(pluginText, [], [plugin(0)])).toEqual([[pluginText, 'mention-pattern']])
  })

  it('rejects stale bounds and token text even beside punctuation', () => {
    expect(summarize('$nuxt-ui, @google-drive!', [
      { ...skill(0), end: 100 }, skill(-1), skill(0, 'different')
    ], [{ ...plugin(10), token: '@wrong' }])).toEqual([['@google-drive!', 'mention-pattern']])
    expect(summarize('$nuxt-ui', [{ ...skill(0), end: 100 }])).toEqual([['$nuxt-ui', 'skill-pattern']])
    expect(summarize('@google-drive', [], [{ ...plugin(0), end: 100 }])).toEqual([['@google-drive', 'mention-pattern']])
    expect(summarize('$bad!', [skill(0, 'bad!')])).toEqual([])
  })

  it('does not highlight selections inside URLs or tokens adjoining URLs', () => {
    const text = 'https://example.com/?skill=$nuxt-ui&plugin=@google-drive @google-drive,https://other.example'
    expect(summarize(text, [skill(text.indexOf('$nuxt-ui'))], [
      plugin(text.indexOf('@google-drive')), plugin(text.lastIndexOf('@google-drive'))
    ])).toEqual([
      ['https://example.com/?skill=$nuxt-ui&plugin=@google-drive', 'link'],
      ['https://other.example', 'link']
    ])
  })

  it('keeps URL queries and nested URL text out of skill and mention ranges', () => {
    const text = 'https://example.com/docs?user=@demo&skill=$nuxt-ui&next=https://other.example $ @'
    expect(summarize(text)).toEqual([
      [text.split(' ')[0], 'link'], ['$', 'skill-pattern'], ['@', 'mention-pattern']
    ])
  })

  it('handles adjacent Markdown destinations, titles, IPv6, and balanced URL parentheses', () => {
    const text = '[one](HTTPS://example.com/a_(b)).[two](https://other.example "Title") <http://[::1]:4310/(x)>。'
    expect(summarize(text)).toEqual([
      ['HTTPS://example.com/a_(b)', 'link'], ['https://other.example', 'link'], ['http://[::1]:4310/(x)', 'link']
    ])
  })

  it('excludes malformed links, unsupported schemes, prose punctuation, and Markdown delimiters', () => {
    const text = 'https:// https://?bad wordhttps://example.com ftp://example.com www.example.com `https://example.com/path` https://other.example/a?!'
    expect(summarize(text)).toEqual([
      ['https://example.com/path', 'link'], ['https://other.example/a', 'link']
    ])
    expect(collectComposerHighlightRanges('')).toEqual([])
  })
})

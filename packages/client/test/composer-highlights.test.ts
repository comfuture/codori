// @vitest-environment jsdom
import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COMPOSER_HIGHLIGHT_NAMES, useComposerHighlights } from '../app/composables/useComposerHighlights'
import type { MentionAutocompleteSelection } from '../shared/mention-autocomplete'
import type { SkillAutocompleteSelection } from '../shared/skill-autocomplete'

class FakeHighlight extends Set<AbstractRange> {}
type FakeRange = AbstractRange & { disconnect: ReturnType<typeof vi.fn> }
let registry: Map<string, FakeHighlight>
const scopes: ReturnType<typeof effectScope>[] = []
const settle = async () => {
  await nextTick()
  await nextTick()
  await nextTick()
}
const fixture = (value: string) => {
  const element = document.createElement('textarea')
  element.value = value
  document.body.append(element)
  const createValueRange = vi.fn((startOffset: number, endOffset: number): FakeRange => ({
    startOffset, endOffset, collapsed: false, startContainer: element, endContainer: element, disconnect: vi.fn()
  }))
  Object.assign(element, { createValueRange })
  const textarea = ref<HTMLTextAreaElement | null>(element)
  const text = ref(value)
  const skills = ref<SkillAutocompleteSelection[]>([])
  const mentions = ref<MentionAutocompleteSelection[]>([])
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useComposerHighlights({ getTextarea: () => textarea.value, text, skills, mentions }))
  return { element, textarea, text, skills, mentions, scope, createValueRange }
}

beforeEach(() => {
  registry = new Map()
  vi.stubGlobal('CSS', { highlights: registry })
  vi.stubGlobal('Highlight', FakeHighlight)
})
afterEach(() => {
  for (const scope of scopes.splice(0)) scope.stop()
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('composer OpaqueRange lifecycle', () => {
  it('paints after DOM updates without changing native value, selection, or focus', async () => {
    const f = fixture('$nuxt-ui')
    f.element.focus()
    f.element.setSelectionRange(2, 5)
    await settle()
    expect(registry.get(COMPOSER_HIGHLIGHT_NAMES['skill-pattern'])?.size).toBe(1)
    expect(f.element.value).toBe('$nuxt-ui')
    expect([f.element.selectionStart, f.element.selectionEnd]).toEqual([2, 5])
    expect(document.activeElement).toBe(f.element)

    f.text.value = '@google-drive'
    // Model assignment comes before the component commits the DOM value.
    f.element.value = '@google-drive'
    await settle()
    expect(registry.has(COMPOSER_HIGHLIGHT_NAMES['skill-pattern'])).toBe(false)
    expect(registry.get(COMPOSER_HIGHLIGHT_NAMES['mention-pattern'])?.size).toBe(1)
  })

  it('refreshes metadata-only selections and clears/disconnects obsolete ranges', async () => {
    const f = fixture('$nuxt-ui @google-drive')
    await settle()
    const firstRange = f.createValueRange.mock.results[0]!.value
    f.skills.value = [{ start: 0, end: 8, name: 'nuxt-ui', path: '/skills/nuxt-ui' }]
    f.mentions.value = [{ start: 9, end: 22, kind: 'plugin', token: '@google-drive', name: 'Drive', path: 'plugin://drive' }]
    await settle()
    expect(firstRange.disconnect).toHaveBeenCalledOnce()
    expect(registry.has(COMPOSER_HIGHLIGHT_NAMES['skill-pattern'])).toBe(false)
    expect(registry.get(COMPOSER_HIGHLIGHT_NAMES['selected-skill'])?.size).toBe(1)
    expect(registry.get(COMPOSER_HIGHLIGHT_NAMES['selected-plugin'])?.size).toBe(1)

    f.element.value = ''
    f.text.value = ''
    await settle()
    expect(registry.size).toBe(0)
  })

  it('shares document groups while removing only the disposing composer ranges', async () => {
    const otherFeature = new FakeHighlight()
    registry.set('other-feature', otherFeature)
    const first = fixture('$nuxt-ui')
    const second = fixture('$another')
    await settle()
    const name = COMPOSER_HIGHLIGHT_NAMES['skill-pattern']
    expect(registry.get(name)?.size).toBe(2)
    first.scope.stop()
    expect(registry.get(name)?.size).toBe(1)
    second.scope.stop()
    expect([...registry.keys()]).toEqual(['other-feature'])
    expect(registry.get('other-feature')).toBe(otherFeature)
  })

  it('rebinds a replaced textarea and cancels a refresh queued before disposal', async () => {
    const f = fixture('@google-drive')
    await settle()
    const oldRange = f.createValueRange.mock.results[0]!.value
    const replacement = document.createElement('textarea')
    replacement.value = '@google-drive'
    const replacementRange = { ...oldRange, disconnect: vi.fn() }
    Object.assign(replacement, { createValueRange: vi.fn(() => replacementRange) })
    f.textarea.value = replacement
    await settle()
    expect(oldRange.disconnect).toHaveBeenCalledOnce()
    expect([...registry.get(COMPOSER_HIGHLIGHT_NAMES['mention-pattern'])!]).toEqual([replacementRange])
    f.text.value = 'changed'
    f.scope.stop()
    await settle()
    expect(registry.size).toBe(0)
  })

  it('falls back safely without a textarea, browser API, or a complete implementation', async () => {
    const f = fixture('$nuxt-ui')
    f.textarea.value = null
    await settle()
    expect(registry.size).toBe(0)
    f.textarea.value = f.element
    vi.stubGlobal('Highlight', undefined)
    await settle()
    expect(registry.size).toBe(0)
    vi.stubGlobal('Highlight', FakeHighlight)
    f.createValueRange.mockImplementation(() => { throw new Error('Unavailable API') })
    f.text.value = '$other'
    await settle()
    expect(registry.size).toBe(0)
    expect(f.element.value).toBe('$nuxt-ui')
  })
})

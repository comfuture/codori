import { nextTick, onScopeDispose, watch, type Ref } from 'vue'
import {
  collectComposerHighlightRanges,
  type ComposerHighlightKind
} from '~~/shared/composer-highlight-ranges'
import type { MentionAutocompleteSelection } from '~~/shared/mention-autocomplete'
import type { SkillAutocompleteSelection } from '~~/shared/skill-autocomplete'

export const COMPOSER_HIGHLIGHT_NAMES: Record<ComposerHighlightKind, string> = {
  'skill-pattern': 'codori-composer-skill-pattern',
  'mention-pattern': 'codori-composer-mention-pattern',
  'selected-skill': 'codori-composer-selected-skill',
  'selected-plugin': 'codori-composer-selected-plugin',
  link: 'codori-composer-link'
}

// These declarations can be removed once the DOM library includes OpaqueRange.
type OpaqueValueRange = AbstractRange & { disconnect?: () => void }
type ValueRangeTextarea = HTMLTextAreaElement & {
  createValueRange?: (start: number, end: number) => OpaqueValueRange
}
type OwnedRange = {
  range: OpaqueValueRange
  highlight: Highlight
  registry: HighlightRegistry
  name: string
}

export const useComposerHighlights = (options: {
  getTextarea: () => HTMLTextAreaElement | null
  text: Readonly<Ref<string>>
  skills: Readonly<Ref<readonly SkillAutocompleteSelection[]>>
  mentions: Readonly<Ref<readonly MentionAutocompleteSelection[]>>
}) => {
  let ownedRanges: OwnedRange[] = []
  let revision = 0
  let disposed = false

  const clearRanges = () => {
    for (const { range, highlight, registry, name } of ownedRanges) {
      highlight.delete(range)
      range.disconnect?.()
      if (!highlight.size && registry.get(name) === highlight) registry.delete(name)
    }
    ownedRanges = []
  }

  const refresh = async () => {
    const currentRevision = ++revision
    // Let UTextarea commit its value and the existing watcher reconcile selections.
    await nextTick()
    if (disposed || currentRevision !== revision) return
    clearRanges()

    const textarea: ValueRangeTextarea | null = options.getTextarea()
    const view = textarea?.ownerDocument.defaultView
    const registry = view?.CSS?.highlights
    if (!textarea || typeof textarea.createValueRange !== 'function'
      || !registry || typeof view?.Highlight !== 'function') return

    try {
      for (const { start, end, kind } of collectComposerHighlightRanges(
        textarea.value, options.skills.value, options.mentions.value
      )) {
        const name = COMPOSER_HIGHLIGHT_NAMES[kind]
        const range = textarea.createValueRange(start, end)
        const highlight = registry.get(name) ?? new view.Highlight()
        ownedRanges.push({ range, highlight, registry, name })
        highlight.add(range)
        registry.set(name, highlight)
      }
    } catch {
      // A partially implemented API must not interrupt normal editing.
      clearRanges()
    }
  }

  watch([options.text, options.skills, options.mentions, options.getTextarea], refresh, {
    immediate: true,
    deep: true,
    flush: 'post'
  })
  onScopeDispose(() => {
    disposed = true
    revision += 1
    clearRanges()
  })
}

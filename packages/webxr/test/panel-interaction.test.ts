import { describe, expect, it } from 'vitest'
import { PanelInteractionModel } from '../src/panel-interaction'

describe('panel interaction model', () => {
  it('separates content selection from grab zones', () => {
    const model = new PanelInteractionModel()
    expect(model.grabStart('left', {
      panelId: 'panel-1',
      zone: 'content'
    })).toBe(false)
    expect(model.selectStart('left', {
      panelId: 'panel-1',
      zone: 'content'
    }, 0)).toBe(true)
    expect(model.snapshot().sources.get('left')?.selected?.zone).toBe('content')
  })

  it('resolves competing grabs deterministically and releases on source loss', () => {
    const model = new PanelInteractionModel()
    const hit = {
      panelId: 'panel-1',
      zone: 'grab' as const
    }
    expect(model.grabStart('left', hit)).toBe(true)
    expect(model.grabStart('right', hit)).toBe(false)
    expect(model.snapshot().grabOwners.get('panel-1')).toBe('left')

    model.sourceLost('left')
    expect(model.grabStart('right', hit)).toBe(true)
    expect(model.snapshot().grabOwners.get('panel-1')).toBe('right')
  })

  it('de-duplicates synthesized hand actions after a native select', () => {
    const model = new PanelInteractionModel()
    const hit = {
      panelId: 'panel-1',
      zone: 'content' as const
    }
    expect(model.selectStart('hand', hit, 1_000, true)).toBe(true)
    expect(model.selectStart('hand', hit, 1_100, false)).toBe(false)
    expect(model.selectStart('hand', hit, 1_300, false)).toBe(true)
  })
})

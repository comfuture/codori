import { describe, expect, it } from 'vitest'
import { resolvePanelVisualState } from '../src/panel-view'

describe('spatial panel visual states', () => {
  it('uses a 250ms standard scale transition', () => {
    expect(resolvePanelVisualState('appearing', 0).normalizedScale).toBe(0)
    expect(resolvePanelVisualState('appearing', 125).normalizedScale)
      .toBeGreaterThan(0.8)
    expect(resolvePanelVisualState('appearing', 250).normalizedScale).toBe(1)
    expect(resolvePanelVisualState('disappearing', 250).normalizedScale).toBe(0)
  })

  it('expands to double size and fades over a 125ms forced dismissal', () => {
    expect(resolvePanelVisualState('bursting', 0)).toMatchObject({
      burstScale: 1,
      opacity: 1,
      particleProgress: 0
    })
    expect(resolvePanelVisualState('bursting', 62.5)).toMatchObject({
      burstScale: 1.125,
      opacity: 0.875,
      particleProgress: 0.5
    })
    expect(resolvePanelVisualState('bursting', 125)).toMatchObject({
      burstScale: 2,
      opacity: 0,
      particleProgress: 1
    })
  })
})

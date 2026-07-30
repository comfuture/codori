import { describe, expect, it } from 'vitest'
import {
  resolvePanelHeight,
  resolvePanelInteractionLayout,
  resolvePanelSlotTransition,
  resolvePanelVisualState
} from '../src/panel-view'

describe('spatial panel visual states', () => {
  it('shrinks short output while keeping the current size as the maximum', () => {
    expect(resolvePanelHeight('done')).toBe(0.44)
    expect(resolvePanelHeight(
      Array.from({ length: 8 }, (_, index) => `line ${index}`).join('\n')
    )).toBeGreaterThan(0.44)
    expect(resolvePanelHeight('output\n'.repeat(40))).toBe(0.92)
    expect(resolvePanelHeight('한'.repeat(300)))
      .toBeGreaterThan(resolvePanelHeight('a'.repeat(300)))
  })

  it('limits the grab target to the visible text-surface header', () => {
    const layout = resolvePanelInteractionLayout(1.55, 0.92)
    const titleBottom = layout.titleBar.y - (layout.titleBar.height / 2)
    const contentTop = layout.content.y + (layout.content.height / 2)

    expect(layout.titleBar).toMatchObject({
      width: 1.48,
      height: 0.11
    })
    expect(contentTop).toBeLessThan(titleBottom)
  })

  it('uses a 250ms standard scale transition', () => {
    expect(resolvePanelVisualState('appearing', 0).normalizedScale).toBe(0)
    expect(resolvePanelVisualState('appearing', 125).normalizedScale)
      .toBeGreaterThan(0.8)
    expect(resolvePanelVisualState('appearing', 250).normalizedScale).toBe(1)
    expect(resolvePanelVisualState('disappearing', 250).normalizedScale).toBe(0)
  })

  it('uses the standard eased transition when cycling panel slots', () => {
    expect(resolvePanelSlotTransition(0)).toBe(0)
    expect(resolvePanelSlotTransition(125)).toBeGreaterThan(0.8)
    expect(resolvePanelSlotTransition(250)).toBe(1)
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

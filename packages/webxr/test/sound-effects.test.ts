import { describe, expect, it } from 'vitest'
import {
  resolveAwakeningSoundPlan,
  resolvePanelAppearSoundPlan
} from '../src/sound-effects'

describe('immersive sound effects', () => {
  it('uses a short rising and settling awakening chord', () => {
    const plan = resolveAwakeningSoundPlan()
    expect(plan.durationSeconds).toBeLessThan(0.8)
    expect(plan.echoWetGain).toBeGreaterThan(0)
    expect(plan.tones).toHaveLength(3)
    expect(plan.tones.every(tone =>
      tone.peakFrequency > tone.startFrequency
      && tone.peakFrequency > tone.endFrequency
    )).toBe(true)
  })

  it('keeps panel appearance short and softly raises grouped volume', () => {
    const single = resolvePanelAppearSoundPlan()
    const grouped = resolvePanelAppearSoundPlan(6)
    expect(single.durationSeconds).toBeLessThan(0.12)
    expect(single.peakGain).toBeLessThan(0.05)
    expect(grouped.peakGain).toBeGreaterThan(single.peakGain)
    expect(grouped.peakGain).toBeLessThanOrEqual(single.peakGain * 1.5)
  })
})

import { describe, expect, it } from 'vitest'
import {
  resolveAwakeningSoundPlan,
  resolvePanelAppearSoundPlan
} from '../src/sound-effects'

describe('immersive sound effects', () => {
  it('raises chords for 700 ms then slowly starts a 300 ms fade', () => {
    const plan = resolveAwakeningSoundPlan()
    expect(plan.durationSeconds).toBe(1)
    expect(plan.frequencyEndSeconds).toBe(0.7)
    expect(plan.releaseStartSeconds).toBe(0.7)
    expect(plan.releaseEasing).toBe('slowStart')
    expect(plan.echoWetGain).toBe(0)
    expect(plan.tones).toHaveLength(7)
    expect(plan.tones.every(tone =>
      tone.peakFrequency > tone.startFrequency
      && tone.endFrequency >= tone.peakFrequency
      && tone.frequencyEasing === 'easeOutCubic'
    )).toBe(true)
    expect(plan.tones.some(tone =>
      tone.wave === 'triangle'
    )).toBe(true)
    expect(Math.max(...plan.tones.map(
      tone => tone.endFrequency
    ))).toBeLessThan(300)
    expect(plan.tones.filter(tone =>
      tone.startFrequency < 70
    )).toHaveLength(5)
    expect(Math.min(...plan.tones.map(
      tone => tone.startFrequency
    ))).toBeLessThan(32)
  })

  it('reuses the layered 250 ms cue for panels and scales grouped volume', () => {
    const single = resolvePanelAppearSoundPlan()
    const grouped = resolvePanelAppearSoundPlan(6)
    expect(single.durationSeconds).toBe(0.25)
    expect(single.tones).toHaveLength(5)
    expect(single.tones.some(tone =>
      tone.startFrequency < 60
    )).toBe(true)
    expect(single.tones.some(tone =>
      tone.delaySeconds >= 0.05
      && tone.endFrequency >= 500
    )).toBe(true)
    expect(grouped.peakGain).toBeGreaterThan(single.peakGain)
    expect(grouped.peakGain).toBeLessThanOrEqual(single.peakGain * 1.5)
  })
})

import { describe, expect, it } from 'vitest'
import {
  AGENT_AWAKENING_FLARE_RISE_SECONDS,
  AGENT_AWAKENING_SETTLE_SECONDS,
  AgentLightAnimator,
  applyAgentAwakening,
  sampleAgentLight
} from '../src/light-model'

describe('agent light model', () => {
  it('is deterministic and bounds scale and local intensity excursions', () => {
    for (const activity of [
      'idle',
      'transcribing',
      'speaking',
      'working',
      'error'
    ] as const) {
      for (let step = 0; step <= 2_000; step += 1) {
        const timeSeconds = step / 200
        const first = sampleAgentLight({
          activity,
          timeSeconds,
          seed: 103
        })
        const second = sampleAgentLight({
          activity,
          timeSeconds,
          seed: 103
        })
        expect(first).toEqual(second)
        expect(first.scale).toBeGreaterThanOrEqual(0.9)
        expect(first.scale).toBeLessThanOrEqual(1.1)
      }
    }

    for (const activity of ['transcribing', 'speaking'] as const) {
      const samples = Array.from({ length: 2_001 }, (_, step) =>
        sampleAgentLight({
          activity,
          timeSeconds: step / 200,
          seed: 103
        }).intensity
      )
      const midpoint = (Math.max(...samples) + Math.min(...samples)) / 2
      expect((Math.max(...samples) - midpoint) / midpoint).toBeLessThan(0.05)
      expect((midpoint - Math.min(...samples)) / midpoint).toBeLessThan(0.05)
    }
  })

  it('maps user and assistant activity to distinct cool and warm energy', () => {
    const transcribing = sampleAgentLight({
      activity: 'transcribing',
      timeSeconds: 0.5
    })
    const speaking = sampleAgentLight({
      activity: 'speaking',
      timeSeconds: 0.5
    })

    expect(transcribing.coolMix).toBeGreaterThan(transcribing.warmMix)
    expect(speaking.warmMix).toBeGreaterThan(speaking.coolMix)
  })

  it('meaningfully lowers speaking motion in reduced-effects mode', () => {
    const normalScales: number[] = []
    const reducedScales: number[] = []
    for (let step = 0; step < 600; step += 1) {
      const timeSeconds = step / 120
      normalScales.push(sampleAgentLight({
        activity: 'speaking',
        timeSeconds,
        reducedEffects: false
      }).scale)
      reducedScales.push(sampleAgentLight({
        activity: 'speaking',
        timeSeconds,
        reducedEffects: true
      }).scale)
    }
    const range = (values: number[]) =>
      Math.max(...values) - Math.min(...values)
    expect(range(reducedScales)).toBeLessThan(range(normalScales) * 0.5)
  })

  it('keeps speaking scale within ten percent and returns near resting size', () => {
    const speakingScales = Array.from({ length: 2_400 }, (_, step) =>
      sampleAgentLight({
        activity: 'speaking',
        timeSeconds: step / 240,
        seed: 103
      }).scale
    )
    expect(Math.max(...speakingScales) - Math.min(...speakingScales))
      .toBeGreaterThan(0.14)

    const animator = new AgentLightAnimator(103, 0.55)
    animator.setActivity('speaking', 0)
    animator.sample(1)
    animator.setActivity('listening', 1)
    expect(Math.abs(animator.sample(1.7).scale - 1)).toBeLessThan(0.01)
  })

  it('keeps assistant micro-pulse peaks near four hertz', () => {
    const durationSeconds = 4
    const sampleRate = 240
    const samples = Array.from(
      { length: durationSeconds * sampleRate },
      (_, step) => sampleAgentLight({
        activity: 'speaking',
        timeSeconds: step / sampleRate,
        seed: 103
      }).intensity
    )
    let peaks = 0
    for (let index = 1; index < samples.length - 1; index += 1) {
      if (
        samples[index]! > samples[index - 1]!
        && samples[index]! >= samples[index + 1]!
      ) {
        peaks += 1
      }
    }
    expect(peaks / durationSeconds).toBeGreaterThanOrEqual(3.5)
    expect(peaks / durationSeconds).toBeLessThanOrEqual(4.5)
  })

  it('cross-fades state changes instead of jumping', () => {
    const animator = new AgentLightAnimator(103, 1)
    const before = animator.sample(1)
    animator.setActivity('speaking', 1)
    const start = animator.sample(1)
    const middle = animator.sample(1.5)
    const end = animator.sample(2.1)

    expect(start.coolMix).toBeCloseTo(before.coolMix)
    expect(middle.coolMix).toBeLessThan(start.coolMix)
    expect(end.warmMix).toBeGreaterThan(end.coolMix)
  })

  it('starts dim and small, flashes, then settles into the current state', () => {
    const baseline = sampleAgentLight({
      activity: 'idle',
      timeSeconds: 0.5,
      seed: 103
    })
    const dormant = applyAgentAwakening(baseline, null)
    const peak = applyAgentAwakening(
      baseline,
      AGENT_AWAKENING_FLARE_RISE_SECONDS
    )
    const settled = applyAgentAwakening(
      baseline,
      AGENT_AWAKENING_FLARE_RISE_SECONDS
        + AGENT_AWAKENING_SETTLE_SECONDS
    )

    expect(dormant.scale).toBeLessThan(baseline.scale * 0.9)
    expect(dormant.intensity).toBeLessThan(baseline.intensity * 0.75)
    expect(dormant.flareIntensity).toBeLessThan(0.1)
    expect(peak.scale).toBeGreaterThan(baseline.scale)
    expect(peak.flareIntensity).toBeGreaterThan(3)
    expect(settled).toEqual(baseline)
  })

  it('reduces the awakening flash when reduced effects are enabled', () => {
    const baseline = sampleAgentLight({
      activity: 'idle',
      timeSeconds: 0.5,
      seed: 103,
      reducedEffects: true
    })
    const normal = applyAgentAwakening(
      baseline,
      AGENT_AWAKENING_FLARE_RISE_SECONDS
    )
    const reduced = applyAgentAwakening(
      baseline,
      AGENT_AWAKENING_FLARE_RISE_SECONDS,
      true
    )
    expect(reduced.flareIntensity).toBeLessThan(normal.flareIntensity)
    expect(reduced.scale - baseline.scale)
      .toBeLessThan(normal.scale - baseline.scale)
  })

  it('holds the dormant state until awakening is explicitly triggered', () => {
    const animator = new AgentLightAnimator(103, 0)
    animator.enterDormant()
    const dormant = animator.sample(10)
    expect(dormant.flareIntensity).toBeLessThan(0.1)

    animator.awaken(10)
    const peak = animator.sample(
      10 + AGENT_AWAKENING_FLARE_RISE_SECONDS
    )
    expect(peak.flareIntensity).toBeGreaterThan(3)

    const awake = animator.sample(
      10
      + AGENT_AWAKENING_FLARE_RISE_SECONDS
      + AGENT_AWAKENING_SETTLE_SECONDS
    )
    expect(awake.flareIntensity).toBe(1)
  })
})

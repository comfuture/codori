import { describe, expect, it } from 'vitest'
import {
  AgentLightAnimator,
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
        expect(first.scale).toBeGreaterThanOrEqual(0.8)
        expect(first.scale).toBeLessThanOrEqual(1.2)
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

  it('varies speaking scale broadly and returns near its resting size', () => {
    const speakingScales = Array.from({ length: 2_400 }, (_, step) =>
      sampleAgentLight({
        activity: 'speaking',
        timeSeconds: step / 240,
        seed: 103
      }).scale
    )
    expect(Math.max(...speakingScales) - Math.min(...speakingScales))
      .toBeGreaterThan(0.28)

    const animator = new AgentLightAnimator(103, 0.55)
    animator.setActivity('speaking', 0)
    animator.sample(1)
    animator.setActivity('listening', 1)
    expect(Math.abs(animator.sample(1.7).scale - 1)).toBeLessThan(0.01)
  })

  it('keeps assistant micro-pulse peaks in the requested rapid range', () => {
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
    expect(peaks / durationSeconds).toBeGreaterThanOrEqual(4)
    expect(peaks / durationSeconds).toBeLessThanOrEqual(7)
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
})

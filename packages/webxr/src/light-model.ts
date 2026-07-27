import {
  LIGHT_INTENSITY_EXCURSION,
  LIGHT_SCALE_EXCURSION,
  REDUCED_LIGHT_INTENSITY_EXCURSION,
  REDUCED_LIGHT_SCALE_EXCURSION
} from './config'

export type RealtimeVisualActivity =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'delegating'
  | 'working'
  | 'speaking'
  | 'error'

export type RgbColor = {
  red: number
  green: number
  blue: number
}

export type LightSample = {
  coolMix: number
  warmMix: number
  saturation: number
  intensity: number
  scale: number
  flarePhase: number
}

const TAU = Math.PI * 2

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

const smoothstep = (value: number) => {
  const clamped = clamp(value, 0, 1)
  return clamped * clamped * (3 - (2 * clamped))
}

const hash = (value: number) => {
  let state = value | 0
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b)
  state = Math.imul(state ^ (state >>> 16), 0x45d9f3b)
  return ((state ^ (state >>> 16)) >>> 0) / 0xffffffff
}

const seededSmoothNoise = (timeSeconds: number, seed: number, rate: number) => {
  const position = Math.max(0, timeSeconds * rate)
  const index = Math.floor(position)
  const fraction = smoothstep(position - index)
  const first = hash(index + seed)
  const second = hash(index + seed + 1)
  return first + ((second - first) * fraction)
}

const activityMix = (activity: RealtimeVisualActivity) => {
  switch (activity) {
    case 'transcribing':
      return { cool: 0.78, warm: 0.22, energy: 0.82 }
    case 'speaking':
      return { cool: 0.25, warm: 0.75, energy: 1 }
    case 'listening':
      return { cool: 0.62, warm: 0.38, energy: 0.7 }
    case 'delegating':
    case 'working':
      return { cool: 0.5, warm: 0.5, energy: 0.58 }
    case 'error':
      return { cool: 0.5, warm: 0.5, energy: 0.38 }
    default:
      return { cool: 0.52, warm: 0.48, energy: 0.66 }
  }
}

export const sampleAgentLight = (input: {
  activity: RealtimeVisualActivity
  timeSeconds: number
  seed?: number
  reducedEffects?: boolean
}): LightSample => {
  const seed = input.seed ?? 0x103
  const mix = activityMix(input.activity)
  const reduced = Boolean(input.reducedEffects)
  const scaleBound = reduced
    ? REDUCED_LIGHT_SCALE_EXCURSION
    : LIGHT_SCALE_EXCURSION
  const intensityBound = reduced
    ? REDUCED_LIGHT_INTENSITY_EXCURSION
    : LIGHT_INTENSITY_EXCURSION
  const intensityExcursion = mix.energy * intensityBound

  let pulse: number
  if (input.activity === 'transcribing') {
    const heartbeatRate = reduced ? 0.55 : 0.85
    const phase = input.timeSeconds * TAU * heartbeatRate
    pulse = (Math.sin(phase) * 0.72) + (Math.sin((phase * 2) - 0.8) * 0.28)
  } else if (input.activity === 'speaking') {
    const frequency = reduced
      ? 0.8
      : 5.25
    const phase = input.timeSeconds * TAU * frequency
    const carrier = Math.sin(phase)
    const microNoise = (seededSmoothNoise(input.timeSeconds, seed + 97, 12) - 0.5) * 0.32
    pulse = clamp((carrier * 0.78) + microNoise, -1, 1)
  } else {
    pulse = Math.sin(input.timeSeconds * TAU * 0.18) * 0.24
  }

  const errorDesaturation = input.activity === 'error'
    ? 0.28 + (smoothstep(Math.min(input.timeSeconds / 0.7, 1)) * 0.22)
    : 1

  return {
    coolMix: mix.cool,
    warmMix: mix.warm,
    saturation: errorDesaturation,
    intensity: clamp(
      mix.energy + (pulse * intensityExcursion),
      mix.energy - intensityExcursion,
      mix.energy + intensityExcursion
    ),
    scale: clamp(
      1 + (pulse * scaleBound),
      1 - scaleBound,
      1 + scaleBound
    ),
    flarePhase: (input.timeSeconds * (reduced ? 0.08 : 0.2)) % 1
  }
}

const mixNumber = (from: number, to: number, progress: number) =>
  from + ((to - from) * progress)

export const mixLightSamples = (
  from: LightSample,
  to: LightSample,
  progress: number
): LightSample => {
  const eased = smoothstep(progress)
  return {
    coolMix: mixNumber(from.coolMix, to.coolMix, eased),
    warmMix: mixNumber(from.warmMix, to.warmMix, eased),
    saturation: mixNumber(from.saturation, to.saturation, eased),
    intensity: mixNumber(from.intensity, to.intensity, eased),
    scale: mixNumber(from.scale, to.scale, eased),
    flarePhase: mixNumber(from.flarePhase, to.flarePhase, eased)
  }
}

export class AgentLightAnimator {
  private activity: RealtimeVisualActivity = 'idle'

  private previousActivity: RealtimeVisualActivity = 'idle'

  private transitionStartedAt = 0

  constructor(
    private readonly seed = 0x103,
    private readonly transitionSeconds = 0.55
  ) {}

  setActivity(activity: RealtimeVisualActivity, timeSeconds: number) {
    if (activity === this.activity) {
      return
    }
    this.previousActivity = this.activity
    this.activity = activity
    this.transitionStartedAt = timeSeconds
  }

  sample(timeSeconds: number, reducedEffects = false) {
    const progress = this.transitionSeconds <= 0
      ? 1
      : clamp((timeSeconds - this.transitionStartedAt) / this.transitionSeconds, 0, 1)
    const previous = sampleAgentLight({
      activity: this.previousActivity,
      timeSeconds,
      seed: this.seed,
      reducedEffects
    })
    const current = sampleAgentLight({
      activity: this.activity,
      timeSeconds,
      seed: this.seed,
      reducedEffects
    })
    return mixLightSamples(previous, current, progress)
  }
}

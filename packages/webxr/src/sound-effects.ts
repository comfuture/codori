import soundEffectPlans from './sound-effect-plans.json'

export type SoundEffectTone = {
  wave: OscillatorType
  delaySeconds: number
  startFrequency: number
  peakFrequency: number
  peakSeconds: number
  endFrequency: number
  gain: number
}

export type SoundEffectPlan = {
  durationSeconds: number
  attackSeconds: number
  releaseStartSeconds: number
  peakGain: number
  echoDelaySeconds: number
  echoFeedback: number
  echoWetGain: number
  tones: SoundEffectTone[]
}

const awakeningPlan = soundEffectPlans.awakening as SoundEffectPlan
const panelAppearPlan = soundEffectPlans.panelAppear as SoundEffectPlan

export const resolveAwakeningSoundPlan = (): SoundEffectPlan => ({
  ...awakeningPlan,
  tones: awakeningPlan.tones.map(tone => ({ ...tone }))
})

export const resolvePanelAppearSoundPlan = (
  panelCount = 1
): SoundEffectPlan => ({
  ...panelAppearPlan,
  peakGain: panelAppearPlan.peakGain * Math.min(
    1.5,
    1 + (Math.max(1, panelCount) - 1) * 0.12
  ),
  tones: panelAppearPlan.tones.map(tone => ({ ...tone }))
})

type AudioContextConstructor = new () => AudioContext

const resolveAudioContextConstructor = () => {
  const scope = globalThis as typeof globalThis & {
    webkitAudioContext?: AudioContextConstructor
  }
  return scope.AudioContext ?? scope.webkitAudioContext ?? null
}

export class ImmersiveSoundEffects {
  private context: AudioContext | null = null

  private ensureContext() {
    if (this.context?.state !== 'closed') {
      return this.context
    }
    const AudioContextClass = resolveAudioContextConstructor()
    if (!AudioContextClass) {
      return null
    }
    this.context = new AudioContextClass()
    return this.context
  }

  async unlock() {
    const context = this.ensureContext()
    if (!context) {
      return false
    }
    try {
      if (context.state === 'suspended') {
        await context.resume()
      }
      return context.state === 'running'
    } catch {
      return false
    }
  }

  private play(plan: SoundEffectPlan) {
    const context = this.ensureContext()
    if (!context || context.state !== 'running') {
      return false
    }
    const start = context.currentTime + 0.008
    const end = start + plan.durationSeconds
    const master = context.createGain()
    master.gain.setValueAtTime(0.0001, start)
    master.gain.exponentialRampToValueAtTime(
      plan.peakGain,
      start + plan.attackSeconds
    )
    master.gain.setValueAtTime(
      plan.peakGain,
      start + plan.releaseStartSeconds
    )
    master.gain.exponentialRampToValueAtTime(0.0001, end)
    master.connect(context.destination)

    const cleanupNodes: AudioNode[] = [master]
    if (
      plan.echoDelaySeconds > 0
      && plan.echoFeedback > 0
      && plan.echoWetGain > 0
    ) {
      const delay = context.createDelay(0.5)
      const feedback = context.createGain()
      const wet = context.createGain()
      delay.delayTime.setValueAtTime(plan.echoDelaySeconds, start)
      feedback.gain.setValueAtTime(plan.echoFeedback, start)
      wet.gain.setValueAtTime(plan.echoWetGain, start)
      master.connect(delay)
      delay.connect(feedback)
      feedback.connect(delay)
      delay.connect(wet)
      wet.connect(context.destination)
      cleanupNodes.push(delay, feedback, wet)
    }

    let remaining = plan.tones.length
    const cleanup = () => {
      remaining -= 1
      if (remaining > 0) {
        return
      }
      globalThis.setTimeout(() => {
        for (const node of cleanupNodes) {
          node.disconnect()
        }
      }, Math.ceil((plan.echoDelaySeconds * 4 + 0.05) * 1_000))
    }
    for (const tone of plan.tones) {
      const oscillator = context.createOscillator()
      const voice = context.createGain()
      const toneStart = start + tone.delaySeconds
      oscillator.type = tone.wave
      oscillator.frequency.setValueAtTime(
        tone.startFrequency,
        toneStart
      )
      oscillator.frequency.exponentialRampToValueAtTime(
        tone.peakFrequency,
        start + tone.peakSeconds
      )
      oscillator.frequency.exponentialRampToValueAtTime(
        tone.endFrequency,
        end
      )
      voice.gain.setValueAtTime(tone.gain, toneStart)
      oscillator.connect(voice)
      voice.connect(master)
      cleanupNodes.push(oscillator, voice)
      oscillator.addEventListener('ended', cleanup, { once: true })
      oscillator.start(toneStart)
      oscillator.stop(end)
    }
    return true
  }

  playAwakening() {
    return this.play(resolveAwakeningSoundPlan())
  }

  playPanelAppear(panelCount = 1) {
    return this.play(resolvePanelAppearSoundPlan(panelCount))
  }

  async dispose() {
    const context = this.context
    this.context = null
    if (context && context.state !== 'closed') {
      await context.close()
    }
  }
}

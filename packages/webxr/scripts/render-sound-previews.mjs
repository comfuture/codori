import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import soundEffectPlans from '../src/sound-effect-plans.json' with {
  type: 'json'
}

const sampleRate = 48_000

const interpolateFrequency = (from, to, progress) =>
  from * ((to / from) ** Math.min(1, Math.max(0, progress)))

const easeOutCubic = progress => 1 - ((1 - progress) ** 3)

const waveSample = (wave, phase) => {
  const sine = Math.sin(phase)
  if (wave === 'triangle') {
    return (2 / Math.PI) * Math.asin(sine)
  }
  if (wave === 'square') {
    return sine >= 0 ? 1 : -1
  }
  if (wave === 'sawtooth') {
    const cycle = phase / (Math.PI * 2)
    return 2 * (cycle - Math.floor(cycle + 0.5))
  }
  return sine
}

const envelopeAt = (plan, time) => {
  if (time < 0 || time >= plan.durationSeconds) {
    return 0
  }
  if (time < plan.attackSeconds) {
    return plan.peakGain * ((time / plan.attackSeconds) ** 1.6)
  }
  if (time <= plan.releaseStartSeconds) {
    return plan.peakGain
  }
  const release = (
    time - plan.releaseStartSeconds
  ) / (
    plan.durationSeconds - plan.releaseStartSeconds
  )
  if (plan.releaseEasing === 'slowStart') {
    return plan.peakGain * (1 - (release ** 3))
  }
  return plan.peakGain * ((1 - release) ** 2.4)
}

const frequencyAt = (plan, tone, time, toneTime) => {
  if (tone.frequencyEasing === 'easeOutCubic') {
    const frequencyEnd = (
      plan.frequencyEndSeconds ?? plan.durationSeconds
    )
    const activeDuration = frequencyEnd - tone.delaySeconds
    return interpolateFrequency(
      tone.startFrequency,
      tone.endFrequency,
      easeOutCubic(Math.min(1, toneTime / activeDuration))
    )
  }
  if (
    tone.peakSeconds >= plan.durationSeconds
    || tone.peakFrequency === tone.endFrequency
  ) {
    const activeDuration = plan.durationSeconds - tone.delaySeconds
    return interpolateFrequency(
      tone.startFrequency,
      tone.endFrequency,
      toneTime / activeDuration
    )
  }
  if (time <= tone.peakSeconds) {
    return interpolateFrequency(
      tone.startFrequency,
      tone.peakFrequency,
      toneTime / (tone.peakSeconds - tone.delaySeconds)
    )
  }
  return interpolateFrequency(
    tone.peakFrequency,
    tone.endFrequency,
    (
      time - tone.peakSeconds
    ) / (
      plan.durationSeconds - tone.peakSeconds
    )
  )
}

const renderPlan = (plan) => {
  const echoTail = plan.echoDelaySeconds > 0
    ? plan.echoDelaySeconds * 5
    : 0
  const frameCount = Math.ceil(
    (plan.durationSeconds + echoTail) * sampleRate
  )
  const samples = new Float32Array(frameCount)
  const delayBuffer = new Float32Array(frameCount)
  const delayFrames = Math.round(plan.echoDelaySeconds * sampleRate)
  const phases = plan.tones.map(() => 0)

  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate
    let dry = 0
    for (const [index, tone] of plan.tones.entries()) {
      const toneTime = time - tone.delaySeconds
      if (toneTime < 0 || time >= plan.durationSeconds) {
        continue
      }
      const frequency = frequencyAt(plan, tone, time, toneTime)
      phases[index] += (Math.PI * 2 * frequency) / sampleRate
      const toneAttack = tone.attackSeconds && tone.attackSeconds > 0
        ? Math.min(1, toneTime / tone.attackSeconds)
        : 1
      dry += (
        waveSample(tone.wave, phases[index])
        * tone.gain
        * toneAttack
      )
    }
    dry *= envelopeAt(plan, time)

    const delayed = delayFrames > 0 && frame >= delayFrames
      ? delayBuffer[frame - delayFrames]
      : 0
    delayBuffer[frame] = dry + (delayed * plan.echoFeedback)
    samples[frame] = Math.tanh(
      dry + (delayed * plan.echoWetGain)
    )
  }
  return samples
}

const wavBuffer = (samples) => {
  const dataBytes = samples.length * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index]))
    buffer.writeInt16LE(Math.round(sample * 0x7fff), 44 + index * 2)
  }
  return buffer
}

const outputDirectory = path.resolve(
  process.argv.slice(2).find(argument => argument !== '--')
    ?? 'sfx-previews'
)
await mkdir(outputDirectory, { recursive: true })

for (const [name, plan] of [
  ['agent-awakening.wav', soundEffectPlans.awakening],
  ['panel-appear.wav', soundEffectPlans.panelAppear]
]) {
  const outputPath = path.join(outputDirectory, name)
  await writeFile(outputPath, wavBuffer(renderPlan(plan)))
  process.stdout.write(`${outputPath}\n`)
}

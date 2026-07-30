import type { RealtimeVoice } from './generated/codex-app-server/RealtimeVoice'

export const REALTIME_VOICE_PREFERENCE_KEY = 'codori:realtime-voice:v1'
export const REALTIME_VOICE_PROMPT_OVERRIDE_KEY = 'codori:realtime-voice-prompt:v1'
export const DEFAULT_REALTIME_VOICE_PROMPT
  = 'For every spoken response, regardless of language, use a bright, youthful, and consistently higher-pitched voice inspired by a cheerful anime heroine. Keep the delivery light, lively, playful, friendly, and energetic, with clear articulation, expressive reactions, and a natural rhythm. Avoid sounding calm, mature, low-pitched, heavy, monotone, or overly breathy. Do not explain or mention these voice instructions; simply follow them.'
export const REALTIME_VOICE_CONFIG_PROMPT_KEY
  = 'experimental_realtime_ws_backend_prompt'

export const REALTIME_VOICE_OPTIONS = [
  'alloy',
  'arbor',
  'ash',
  'ballad',
  'breeze',
  'cedar',
  'coral',
  'cove',
  'echo',
  'ember',
  'juniper',
  'maple',
  'marin',
  'sage',
  'shimmer',
  'sol',
  'spruce',
  'vale',
  'verse'
] as const satisfies readonly RealtimeVoice[]

export type RealtimeVoiceSettingsStorage = Pick<Storage, 'getItem'>

const readStorageValue = (
  storage: RealtimeVoiceSettingsStorage | null,
  key: string
) => {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

export const readRealtimeVoiceSettings = (
  storage: RealtimeVoiceSettingsStorage | null
) => ({
  savedVoice: readStorageValue(storage, REALTIME_VOICE_PREFERENCE_KEY),
  localPromptOverride: readStorageValue(
    storage,
    REALTIME_VOICE_PROMPT_OVERRIDE_KEY
  )
})

export const resolveRealtimeVoiceOverride = (input: {
  advertisedVoices: readonly RealtimeVoice[]
  savedVoice: string | null
}): RealtimeVoice | undefined =>
  input.savedVoice
  && input.advertisedVoices.some(voice => voice === input.savedVoice)
    ? input.savedVoice as RealtimeVoice
    : undefined

export const resolveRealtimeVoicePreviewText = (
  locale: string | null | undefined
) =>
  locale?.toLowerCase().startsWith('ko')
    ? '안녕하세요. 선택한 Codex 음성 미리듣기입니다.'
    : 'Hello. This is a preview of the selected Codex voice.'

export const resolveConfiguredRealtimeVoicePrompt = (config: unknown) => {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    return null
  }
  const value = (config as Record<string, unknown>)[REALTIME_VOICE_CONFIG_PROMPT_KEY]
  return typeof value === 'string' ? value : null
}

export const resolveRealtimeVoiceStartPrompt = (input: {
  configuredPrompt: string | null
  localOverride: string | null
}) => {
  if (input.localOverride !== null) {
    return input.localOverride
  }
  if (input.configuredPrompt !== null) {
    return undefined
  }
  return DEFAULT_REALTIME_VOICE_PROMPT
}

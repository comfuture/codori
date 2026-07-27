import { computed, onMounted, ref } from 'vue'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'

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

export type RealtimeVoicePreferenceStorage = Pick<
  Storage,
  'getItem' | 'removeItem' | 'setItem'
>

export const resolveRealtimeVoiceOverride = (input: {
  advertisedVoices: readonly RealtimeVoice[]
  savedVoice: string | null
}): RealtimeVoice | undefined =>
  input.savedVoice
  && input.advertisedVoices.some(voice => voice === input.savedVoice)
    ? input.savedVoice as RealtimeVoice
    : undefined

export const resolveRealtimeVoicePreviewText = (locale: string | null | undefined) =>
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

export const createRealtimeVoicePreference = (
  storage: RealtimeVoicePreferenceStorage | null
) => {
  const initialVoice = (() => {
    try {
      return storage?.getItem(REALTIME_VOICE_PREFERENCE_KEY) ?? null
    } catch {
      return null
    }
  })()

  const savedVoice = ref<string | null>(initialVoice)
  let activeStorage = storage

  const hydrate = (nextStorage: RealtimeVoicePreferenceStorage | null) => {
    activeStorage = nextStorage
    try {
      savedVoice.value = nextStorage?.getItem(REALTIME_VOICE_PREFERENCE_KEY) ?? null
    } catch {
      savedVoice.value = null
    }
  }

  const selectVoice = (voice: RealtimeVoice | null) => {
    savedVoice.value = voice
    try {
      if (voice) {
        activeStorage?.setItem(REALTIME_VOICE_PREFERENCE_KEY, voice)
      } else {
        activeStorage?.removeItem(REALTIME_VOICE_PREFERENCE_KEY)
      }
    } catch {
      // Voice selection remains usable for this page when storage is unavailable.
    }
  }

  return {
    savedVoice,
    usesCodexSetting: computed(() => savedVoice.value === null),
    hydrate,
    selectVoice
  }
}

let sharedPreference: ReturnType<typeof createRealtimeVoicePreference> | null = null

export const createRealtimeVoicePromptPreference = (
  storage: RealtimeVoicePreferenceStorage | null
) => {
  const readOverride = (candidate: RealtimeVoicePreferenceStorage | null) => {
    try {
      return candidate?.getItem(REALTIME_VOICE_PROMPT_OVERRIDE_KEY) ?? null
    } catch {
      return null
    }
  }
  const savedPrompt = ref<string | null>(readOverride(storage))
  let activeStorage = storage

  const hydrate = (nextStorage: RealtimeVoicePreferenceStorage | null) => {
    activeStorage = nextStorage
    savedPrompt.value = readOverride(nextStorage)
  }

  const setPrompt = (prompt: string | null) => {
    const normalized = prompt?.trim() || null
    savedPrompt.value = normalized
    try {
      if (normalized) {
        activeStorage?.setItem(REALTIME_VOICE_PROMPT_OVERRIDE_KEY, normalized)
      } else {
        activeStorage?.removeItem(REALTIME_VOICE_PROMPT_OVERRIDE_KEY)
      }
    } catch {
      // Keep the override usable for this page when storage is unavailable.
    }
  }

  return {
    savedPrompt,
    hydrate,
    setPrompt
  }
}

let sharedPromptPreference: ReturnType<
  typeof createRealtimeVoicePromptPreference
> | null = null

const resolveBrowserStorage = (): RealtimeVoicePreferenceStorage | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const useRealtimeVoicePreference = () => {
  if (!sharedPreference) {
    // Keep SSR and the first client render identical. Browser persistence is
    // applied only after hydration has completed.
    sharedPreference = createRealtimeVoicePreference(null)
  }
  if (import.meta.client) {
    onMounted(() => {
      sharedPreference?.hydrate(resolveBrowserStorage())
    })
  }
  return sharedPreference
}

export const useRealtimeVoicePromptPreference = () => {
  if (!sharedPromptPreference) {
    sharedPromptPreference = createRealtimeVoicePromptPreference(null)
  }
  if (import.meta.client) {
    onMounted(() => {
      sharedPromptPreference?.hydrate(resolveBrowserStorage())
    })
  }
  return sharedPromptPreference
}

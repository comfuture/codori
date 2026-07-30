import { computed, onMounted, ref } from 'vue'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'
import {
  readRealtimeVoiceSettings,
  REALTIME_VOICE_PREFERENCE_KEY,
  REALTIME_VOICE_PROMPT_OVERRIDE_KEY
} from '~~/shared/realtime-voice-settings'

export type RealtimeVoicePreferenceStorage = Pick<
  Storage,
  'getItem' | 'removeItem' | 'setItem'
>

export const createRealtimeVoicePreference = (
  storage: RealtimeVoicePreferenceStorage | null
) => {
  const initialVoice = readRealtimeVoiceSettings(storage).savedVoice

  const savedVoice = ref<string | null>(initialVoice)
  let activeStorage = storage

  const hydrate = (nextStorage: RealtimeVoicePreferenceStorage | null) => {
    activeStorage = nextStorage
    savedVoice.value = readRealtimeVoiceSettings(nextStorage).savedVoice
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
    return readRealtimeVoiceSettings(candidate).localPromptOverride
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

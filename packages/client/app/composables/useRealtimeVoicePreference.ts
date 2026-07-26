import { computed, onMounted, ref } from 'vue'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'

export const REALTIME_VOICE_PREFERENCE_KEY = 'codori:realtime-voice:v1'

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

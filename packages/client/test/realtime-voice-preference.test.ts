import { describe, expect, it, vi } from 'vitest'
import {
  createRealtimeVoicePromptPreference,
  createRealtimeVoicePreference
} from '../app/composables/useRealtimeVoicePreference'
import {
  DEFAULT_REALTIME_VOICE_PROMPT,
  REALTIME_VOICE_CONFIG_PROMPT_KEY,
  REALTIME_VOICE_PREFERENCE_KEY,
  REALTIME_VOICE_PROMPT_OVERRIDE_KEY,
  resolveConfiguredRealtimeVoicePrompt,
  resolveRealtimeVoiceOverride,
  resolveRealtimeVoicePreviewText,
  resolveRealtimeVoiceStartPrompt
} from '../shared/realtime-voice-settings'

describe('realtime voice preference', () => {
  it('uses a language-independent default voice prompt', () => {
    expect(DEFAULT_REALTIME_VOICE_PROMPT).toContain('regardless of language')
    expect(DEFAULT_REALTIME_VOICE_PROMPT).not.toContain('Speak Japanese')
  })

  it('omits the session override for the Codex setting and stale saved values', () => {
    expect(resolveRealtimeVoiceOverride({
      advertisedVoices: ['cove', 'juniper'],
      savedVoice: null
    })).toBeUndefined()
    expect(resolveRealtimeVoiceOverride({
      advertisedVoices: ['cove', 'juniper'],
      savedVoice: 'shimmer'
    })).toBeUndefined()
    expect(resolveRealtimeVoiceOverride({
      advertisedVoices: ['juniper', 'cove'],
      savedVoice: 'cove'
    })).toBe('cove')
  })

  it('persists explicit choices while preserving a stale value for diagnostics', () => {
    const values = new Map<string, string>([
      [REALTIME_VOICE_PREFERENCE_KEY, 'shimmer']
    ])
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value)
      }),
      removeItem: vi.fn((key: string) => {
        values.delete(key)
      })
    }
    const preference = createRealtimeVoicePreference(storage)

    expect(preference.savedVoice.value).toBe('shimmer')
    expect(resolveRealtimeVoiceOverride({
      advertisedVoices: ['cove'],
      savedVoice: preference.savedVoice.value
    })).toBeUndefined()
    expect(storage.removeItem).not.toHaveBeenCalled()

    preference.selectVoice('cove')
    expect(storage.setItem).toHaveBeenCalledWith(
      REALTIME_VOICE_PREFERENCE_KEY,
      'cove'
    )

    preference.selectVoice(null)
    expect(storage.removeItem).toHaveBeenCalledWith(REALTIME_VOICE_PREFERENCE_KEY)
  })

  it('supports hydration-stable browser persistence after the initial render', () => {
    const storage = {
      getItem: vi.fn(() => 'cove'),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
    const preference = createRealtimeVoicePreference(null)

    expect(preference.savedVoice.value).toBeNull()
    preference.hydrate(storage)
    expect(preference.savedVoice.value).toBe('cove')
  })

  it('uses a short neutral sample for the browser locale', () => {
    expect(resolveRealtimeVoicePreviewText('ko-KR')).toContain('미리듣기')
    expect(resolveRealtimeVoicePreviewText('en-US')).toContain('preview')
  })

  it('uses a local voice prompt override before config and the Codori fallback', () => {
    expect(resolveConfiguredRealtimeVoicePrompt({
      [REALTIME_VOICE_CONFIG_PROMPT_KEY]: 'Configured voice prompt'
    })).toBe('Configured voice prompt')
    expect(resolveRealtimeVoiceStartPrompt({
      configuredPrompt: 'Configured voice prompt',
      localOverride: null
    })).toBeUndefined()
    expect(resolveRealtimeVoiceStartPrompt({
      configuredPrompt: 'Configured voice prompt',
      localOverride: 'Local voice prompt'
    })).toBe('Local voice prompt')
    expect(resolveRealtimeVoiceStartPrompt({
      configuredPrompt: null,
      localOverride: null
    })).toBe(DEFAULT_REALTIME_VOICE_PROMPT)
  })

  it('persists and clears the browser-only voice prompt override', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn()
    }
    const preference = createRealtimeVoicePromptPreference(storage)

    preference.setPrompt('  Local voice prompt  ')
    expect(preference.savedPrompt.value).toBe('Local voice prompt')
    expect(storage.setItem).toHaveBeenCalledWith(
      REALTIME_VOICE_PROMPT_OVERRIDE_KEY,
      'Local voice prompt'
    )

    preference.setPrompt(null)
    expect(preference.savedPrompt.value).toBeNull()
    expect(storage.removeItem).toHaveBeenCalledWith(
      REALTIME_VOICE_PROMPT_OVERRIDE_KEY
    )
  })
})

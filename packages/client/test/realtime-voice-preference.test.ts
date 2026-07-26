import { describe, expect, it, vi } from 'vitest'
import {
  createRealtimeVoicePreference,
  REALTIME_VOICE_PREFERENCE_KEY,
  resolveRealtimeVoiceOverride,
  resolveRealtimeVoicePreviewText
} from '../app/composables/useRealtimeVoicePreference'

describe('realtime voice preference', () => {
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
})

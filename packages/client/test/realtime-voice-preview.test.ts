import { existsSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  REALTIME_VOICE_PREVIEW_SOURCES,
  REALTIME_VOICE_PREVIEW_VOICES,
  selectRealtimeVoicePreviewSource
} from '../shared/realtime-voice-preview'

describe('realtime voice preview assets', () => {
  it('maps every bundled preview voice to an Opus public asset', () => {
    expect(REALTIME_VOICE_PREVIEW_VOICES).toEqual([
      'arbor',
      'breeze',
      'cove',
      'ember',
      'juniper',
      'maple',
      'sol',
      'spruce',
      'vale'
    ])

    for (const voice of REALTIME_VOICE_PREVIEW_VOICES) {
      expect(REALTIME_VOICE_PREVIEW_SOURCES[voice]).toEqual([{
        src: `/voice-previews/${voice}.opus`,
        type: 'audio/ogg; codecs=opus'
      }])
    }
  })

  it('keeps the complete preview payload below 256 KiB', () => {
    const totalBytes = REALTIME_VOICE_PREVIEW_VOICES.reduce((total, voice) => {
      const path = resolve(
        import.meta.dirname,
        `../public/voice-previews/${voice}.opus`
      )
      expect(existsSync(path)).toBe(true)
      return total + statSync(path).size
    }, 0)

    expect(totalBytes).toBeLessThan(256 * 1024)
  })

  it('selects only a browser-supported preview source', () => {
    expect(selectRealtimeVoicePreviewSource('cove', () => 'probably')).toEqual({
      src: '/voice-previews/cove.opus',
      type: 'audio/ogg; codecs=opus'
    })
    expect(selectRealtimeVoicePreviewSource('alloy', () => 'probably')).toBeNull()
    expect(selectRealtimeVoicePreviewSource('cove', () => '')).toBeNull()
  })
})

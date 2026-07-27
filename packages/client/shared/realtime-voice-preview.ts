import type { RealtimeVoice } from './generated/codex-app-server/RealtimeVoice'

export type RealtimeVoicePreviewSource = {
  src: string
  type: string
}

const previewSources = (voice: string): readonly RealtimeVoicePreviewSource[] => [
  {
    src: `/voice-previews/${voice}.opus`,
    type: 'audio/ogg; codecs=opus'
  }
]

export const REALTIME_VOICE_PREVIEW_SOURCES = {
  arbor: previewSources('arbor'),
  breeze: previewSources('breeze'),
  cove: previewSources('cove'),
  ember: previewSources('ember'),
  juniper: previewSources('juniper'),
  maple: previewSources('maple'),
  sol: previewSources('sol'),
  spruce: previewSources('spruce'),
  vale: previewSources('vale')
} as const satisfies Partial<
  Record<RealtimeVoice, readonly RealtimeVoicePreviewSource[]>
>

export const REALTIME_VOICE_PREVIEW_VOICES = Object.keys(
  REALTIME_VOICE_PREVIEW_SOURCES
) as Array<keyof typeof REALTIME_VOICE_PREVIEW_SOURCES>

export const selectRealtimeVoicePreviewSource = (
  voice: RealtimeVoice,
  canPlayType: (type: string) => CanPlayTypeResult
) => {
  const sources = REALTIME_VOICE_PREVIEW_SOURCES[
    voice as keyof typeof REALTIME_VOICE_PREVIEW_SOURCES
  ]
  return sources?.find(source => canPlayType(source.type) !== '') ?? null
}

import type { ExperimentalFeatureListResponse } from './generated/codex-app-server/v2/ExperimentalFeatureListResponse'
import type { RealtimeVoice } from './generated/codex-app-server/RealtimeVoice'

export type RealtimeCapabilityStatus =
  | 'checking'
  | 'available'
  | 'disabled'
  | 'unsupported'
  | 'insecure-context'
  | 'failed'

export type RealtimeSessionState =
  | 'idle'
  | 'requesting-permission'
  | 'creating-offer'
  | 'starting'
  | 'connected'
  | 'stopping'
  | 'closed'
  | 'error'

export type RealtimeSessionKind = 'conversation' | 'preview'

export type RealtimeVoiceCatalogStatus = 'idle' | 'loading' | 'ready' | 'error'

export type RealtimeVoiceCatalog = {
  status: RealtimeVoiceCatalogStatus
  voices: RealtimeVoice[]
  protocolDefault: RealtimeVoice | null
  error: string | null
}

export type RealtimeVoicePreviewStatus =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'blocked'
  | 'stopping'
  | 'error'

export type RealtimeActivity =
  | 'idle'
  | 'listening'
  | 'transcribing'
  | 'delegating'
  | 'working'
  | 'speaking'

export type RealtimeAvatarCueKind =
  | 'turn-start'
  | 'tool-start'
  | 'tool-failed'
  | 'turn-complete'
  | 'turn-failed'

export type RealtimeAvatarCue = {
  kind: RealtimeAvatarCueKind
  sequence: number
}

export type RealtimeCapability = {
  status: RealtimeCapabilityStatus
  message: string
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const isUnsupportedMethodError = (message: string) =>
  /method not found|-32601|experimental api.*unsupported/i.test(message)

export const resolveRealtimeCapability = (input: {
  configured: boolean
  secureContext: boolean
  browserSupported: boolean
  response?: ExperimentalFeatureListResponse
  error?: unknown
}): RealtimeCapability => {
  if (!input.configured) {
    return {
      status: 'disabled',
      message: 'Experimental realtime voice is disabled in Codori.'
    }
  }

  if (!input.secureContext) {
    return {
      status: 'insecure-context',
      message: 'Voice requires localhost or a secure HTTPS connection.'
    }
  }

  if (!input.browserSupported) {
    return {
      status: 'unsupported',
      message: 'This browser does not support the required microphone and WebRTC APIs.'
    }
  }

  if (input.error) {
    const message = errorMessage(input.error)
    return {
      status: isUnsupportedMethodError(message) ? 'unsupported' : 'failed',
      message: isUnsupportedMethodError(message)
        ? 'This Codex app-server does not expose realtime conversations.'
        : `Could not check realtime voice support: ${message}`
    }
  }

  const feature = input.response?.data.find(candidate => candidate.name === 'realtime_conversation')
  if (!feature || feature.stage === 'removed') {
    return {
      status: 'unsupported',
      message: 'This Codex app-server does not support realtime conversations.'
    }
  }

  if (!feature.enabled) {
    return {
      status: 'disabled',
      message: 'Realtime voice is configured but the managed app-server has not enabled it. Restart Codori.'
    }
  }

  return {
    status: 'available',
    message: 'Realtime voice is available.'
  }
}

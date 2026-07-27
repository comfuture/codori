import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexRpcClient } from '@codori/client/shared/codex-rpc'
import type {
  RealtimeConversationSnapshot
} from '@codori/client/shared/realtime'

const controllerFixture = vi.hoisted(() => ({
  current: null as RealtimeConversationSnapshot | null,
  subscriber: null as (
    (snapshot: RealtimeConversationSnapshot) => void
  ) | null,
  setMicrophoneEnabled: vi.fn(),
  connect: vi.fn(),
  dispose: vi.fn(),
  stop: vi.fn(),
  setOutputMuted: vi.fn(),
  setCapability: vi.fn()
}))

const snapshot = (
  state: RealtimeConversationSnapshot['state']
): RealtimeConversationSnapshot => ({
  capability: {
    status: 'available',
    message: 'Realtime voice is available.'
  },
  state,
  activity: 'idle',
  sessionKind: state === 'idle' ? null : 'conversation',
  activeVoice: null,
  owningThreadId: state === 'idle' ? null : 'thread-1',
  generation: state === 'idle' ? 0 : 1,
  transcripts: [],
  latestUserTranscript: null,
  error: null,
  outputMuted: false,
  autoplayBlocked: false,
  microphoneEnabled: false,
  remoteAudioActive: false,
  peerConnectionState: state === 'connected' ? 'connected' : null,
  voiceCatalog: {
    status: 'idle',
    voices: [],
    protocolDefault: null,
    error: null
  },
  previewStatus: 'idle',
  previewError: null
})

vi.mock('@codori/client/shared/realtime', () => ({
  createRealtimeConversationController: () => ({
    getSnapshot: () => controllerFixture.current,
    subscribe: (
      listener: (next: RealtimeConversationSnapshot) => void
    ) => {
      controllerFixture.subscriber = listener
      listener(controllerFixture.current!)
      return () => {
        controllerFixture.subscriber = null
      }
    },
    refreshCapability: async () => {
      controllerFixture.current = snapshot('idle')
      controllerFixture.subscriber?.(controllerFixture.current)
      return controllerFixture.current.capability
    },
    connect: controllerFixture.connect,
    setMicrophoneEnabled: controllerFixture.setMicrophoneEnabled,
    setOutputMuted: controllerFixture.setOutputMuted,
    setCapability: controllerFixture.setCapability,
    stop: controllerFixture.stop,
    dispose: controllerFixture.dispose
  })
}))

import { VoiceRuntime } from '../src/voice-runtime'

describe('voice runtime', () => {
  beforeEach(() => {
    controllerFixture.current = snapshot('idle')
    controllerFixture.subscriber = null
    controllerFixture.setMicrophoneEnabled.mockReset()
    controllerFixture.connect.mockReset()
    controllerFixture.connect.mockImplementation(async () => {
      controllerFixture.current = snapshot('connected')
      controllerFixture.subscriber?.(controllerFixture.current)
    })
    controllerFixture.dispose.mockReset()
    controllerFixture.dispose.mockResolvedValue(undefined)
    controllerFixture.stop.mockReset()
    controllerFixture.stop.mockResolvedValue(undefined)
    controllerFixture.setOutputMuted.mockReset()
    controllerFixture.setCapability.mockReset()
  })

  it('enables the microphone after an idle capability refresh connects', async () => {
    const runtime = new VoiceRuntime({
      client: {} as CodexRpcClient,
      threadId: 'thread-1',
      fetch: vi.fn(async () => new Response(JSON.stringify({
        capabilities: {
          realtimeVoice: {
            configured: true
          }
        }
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      }))
    })

    await runtime.toggle()

    expect(controllerFixture.connect).toHaveBeenCalledWith('thread-1')
    expect(controllerFixture.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    await runtime.dispose()
  })

  it('keeps the microphone pending through idle connection setup snapshots', async () => {
    controllerFixture.connect.mockImplementation(async () => {
      controllerFixture.current = {
        ...snapshot('idle'),
        owningThreadId: 'thread-1',
        generation: 1
      }
      controllerFixture.subscriber?.(controllerFixture.current)
      controllerFixture.current = snapshot('connected')
      controllerFixture.subscriber?.(controllerFixture.current)
    })
    const runtime = new VoiceRuntime({
      client: {} as CodexRpcClient,
      threadId: 'thread-1',
      fetch: vi.fn(async () => new Response(JSON.stringify({
        capabilities: {
          realtimeVoice: {
            configured: true
          }
        }
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json'
        }
      }))
    })

    await runtime.toggle()

    expect(controllerFixture.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    await runtime.dispose()
  })
})

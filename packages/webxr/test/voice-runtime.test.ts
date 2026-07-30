import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexRpcClient } from '@codori/client/shared/codex-rpc'
import type {
  RealtimeConversationSnapshot
} from '@codori/client/shared/realtime'
import {
  DEFAULT_REALTIME_VOICE_PROMPT,
  REALTIME_VOICE_PREFERENCE_KEY,
  REALTIME_VOICE_PROMPT_OVERRIDE_KEY
} from '@codori/client/shared/realtime-voice-settings'

const controllerFixture = vi.hoisted(() => ({
  current: null as RealtimeConversationSnapshot | null,
  subscriber: null as (
    (snapshot: RealtimeConversationSnapshot) => void
  ) | null,
  refreshVoiceCatalog: vi.fn(),
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
    refreshVoiceCatalog: controllerFixture.refreshVoiceCatalog,
    connect: controllerFixture.connect,
    setMicrophoneEnabled: controllerFixture.setMicrophoneEnabled,
    setOutputMuted: controllerFixture.setOutputMuted,
    setCapability: controllerFixture.setCapability,
    stop: controllerFixture.stop,
    dispose: controllerFixture.dispose
  })
}))

import {
  resolveImmersiveVoiceActivity,
  VoiceRuntime
} from '../src/voice-runtime'

const capabilityFetch = vi.fn(async () => new Response(JSON.stringify({
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

const createClient = (
  config: Record<string, unknown> = {
    experimental_realtime_ws_backend_prompt: 'Configured prompt'
  }
) => ({
  request: vi.fn(async (method: string) => {
    if (method === 'config/read') {
      return { config }
    }
    throw new Error(`Unexpected request: ${method}`)
  })
}) as unknown as CodexRpcClient

const createStorage = (values: Record<string, string>) => ({
  getItem: vi.fn((key: string) => values[key] ?? null)
})

describe('voice runtime', () => {
  beforeEach(() => {
    controllerFixture.current = snapshot('idle')
    controllerFixture.subscriber = null
    controllerFixture.refreshVoiceCatalog.mockReset()
    controllerFixture.refreshVoiceCatalog.mockResolvedValue({
      status: 'ready',
      voices: ['cove', 'juniper'],
      protocolDefault: 'cove',
      error: null
    })
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

  it('returns the orb to listening after the assistant utterance is final', () => {
    const speaking = {
      ...snapshot('connected'),
      activity: 'speaking' as const,
      microphoneEnabled: true,
      transcripts: [{
        id: 1,
        generation: 1,
        role: 'assistant' as const,
        text: 'Finished response',
        final: true
      }]
    }

    expect(resolveImmersiveVoiceActivity(speaking)).toBe('listening')
    expect(resolveImmersiveVoiceActivity({
      ...speaking,
      transcripts: [{
        ...speaking.transcripts[0]!,
        final: false
      }]
    })).toBe('speaking')
  })

  it('enables the microphone after an idle capability refresh connects', async () => {
    const runtime = new VoiceRuntime({
      client: createClient(),
      threadId: 'thread-1',
      fetch: capabilityFetch
    })

    await runtime.toggle()

    expect(controllerFixture.connect).toHaveBeenCalledWith('thread-1', {})
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
      client: createClient(),
      threadId: 'thread-1',
      fetch: capabilityFetch
    })

    await runtime.toggle()

    expect(controllerFixture.setMicrophoneEnabled).toHaveBeenCalledWith(true)
    await runtime.dispose()
  })

  it('does not stop or reconnect an already active session when auto-start repeats', async () => {
    controllerFixture.current = snapshot('connected')
    const runtime = new VoiceRuntime({
      client: createClient(),
      threadId: 'thread-1',
      fetch: vi.fn()
    })

    await runtime.start()

    expect(controllerFixture.connect).not.toHaveBeenCalled()
    expect(controllerFixture.stop).not.toHaveBeenCalled()
    await runtime.dispose()
  })

  it('applies the saved advertised voice and browser instructions', async () => {
    const client = createClient()
    const runtime = new VoiceRuntime({
      client,
      threadId: 'thread-1',
      cwd: '/projects/codori',
      storage: createStorage({
        [REALTIME_VOICE_PREFERENCE_KEY]: 'juniper',
        [REALTIME_VOICE_PROMPT_OVERRIDE_KEY]: 'XR browser prompt'
      }),
      fetch: capabilityFetch
    })

    await runtime.start()

    expect(controllerFixture.connect).toHaveBeenCalledWith('thread-1', {
      voice: 'juniper',
      prompt: 'XR browser prompt'
    })
    expect(client.request).not.toHaveBeenCalledWith(
      'config/read',
      expect.anything()
    )
    await runtime.dispose()
  })

  it('omits stale settings and keeps config.toml authoritative', async () => {
    const client = createClient()
    const runtime = new VoiceRuntime({
      client,
      threadId: 'thread-1',
      cwd: '/projects/codori',
      storage: createStorage({
        [REALTIME_VOICE_PREFERENCE_KEY]: 'shimmer'
      }),
      fetch: capabilityFetch
    })

    await runtime.start()

    expect(client.request).toHaveBeenCalledWith('config/read', {
      includeLayers: false,
      cwd: '/projects/codori'
    })
    expect(controllerFixture.connect).toHaveBeenCalledWith('thread-1', {})
    await runtime.dispose()
  })

  it('uses the Codori prompt when config.toml has no voice instructions', async () => {
    const runtime = new VoiceRuntime({
      client: createClient({}),
      threadId: 'thread-1',
      storage: createStorage({}),
      fetch: capabilityFetch
    })

    await runtime.start()

    expect(controllerFixture.connect).toHaveBeenCalledWith('thread-1', {
      prompt: DEFAULT_REALTIME_VOICE_PROMPT
    })
    await runtime.dispose()
  })

  it('continues without a prompt when config reading times out', async () => {
    const client = {
      request: vi.fn(() => new Promise<never>(() => {}))
    } as unknown as CodexRpcClient
    const runtime = new VoiceRuntime({
      client,
      threadId: 'thread-1',
      storage: createStorage({}),
      fetch: capabilityFetch,
      configReadTimeoutMs: 1
    })

    await runtime.start()

    expect(controllerFixture.connect).toHaveBeenCalledWith('thread-1', {})
    await runtime.dispose()
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  resolveRealtimeCapability,
  useRealtimeConversation,
  type RealtimeBrowserEnvironment
} from '../app/composables/useRealtimeConversation'
import type { CodexRpcConnectionState, CodexRpcNotification } from '../shared/codex-rpc'

const enabledFeatureResponse = {
  data: [{
    name: 'realtime_conversation',
    stage: 'underDevelopment' as const,
    displayName: null,
    description: null,
    announcement: null,
    enabled: true,
    defaultEnabled: false
  }],
  nextCursor: null
}

class FakeTrack {
  enabled = true
  stop = vi.fn()
  readonly endedListeners = new Set<() => void>()

  addEventListener(_type: 'ended', listener: () => void) {
    this.endedListeners.add(listener)
  }

  removeEventListener(_type: 'ended', listener: () => void) {
    this.endedListeners.delete(listener)
  }

  end() {
    for (const listener of this.endedListeners) {
      listener()
    }
  }
}

class FakeStream {
  constructor(readonly track = new FakeTrack()) {}

  getAudioTracks() {
    return [this.track]
  }

  getTracks() {
    return [this.track]
  }
}

class FakeDataChannel {
  close = vi.fn()
}

class FakeAudioElement {
  autoplay = false
  muted = false
  srcObject: FakeStream | null = null
  play = vi.fn(async () => {})
  pause = vi.fn()
}

class FakePeerConnection {
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  remoteDescription: RTCSessionDescriptionInit | null = null
  ontrack: ((event: { streams: FakeStream[] }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  readonly dataChannel = new FakeDataChannel()
  readonly addTrack = vi.fn()
  readonly createDataChannel = vi.fn(() => this.dataChannel)
  readonly createOffer = vi.fn(async () => ({ type: 'offer' as const, sdp: 'offer-sdp' }))
  readonly setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description
  })
  readonly setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description
  })
  readonly close = vi.fn(() => {
    this.connectionState = 'closed'
  })
}

class FakeRpcClient {
  readonly requests: Array<{ method: string, params: unknown }> = []
  readonly notificationListeners = new Set<(notification: CodexRpcNotification) => void>()
  readonly connectionListeners = new Set<(state: CodexRpcConnectionState) => void>()
  connected = true
  featureResponse = enabledFeatureResponse
  startError: Error | null = null

  async request<T>(method: string, params?: unknown): Promise<T> {
    this.requests.push({ method, params })
    if (method === 'experimentalFeature/list') {
      return this.featureResponse as T
    }
    if (method === 'thread/realtime/start' && this.startError) {
      throw this.startError
    }
    return {} as T
  }

  subscribe(listener: (notification: CodexRpcNotification) => void) {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  subscribeConnectionState(listener: (state: CodexRpcConnectionState) => void) {
    this.connectionListeners.add(listener)
    return () => this.connectionListeners.delete(listener)
  }

  isConnected() {
    return this.connected
  }

  emit(method: CodexRpcNotification['method'], params: Record<string, unknown>) {
    for (const listener of this.notificationListeners) {
      listener({ method, params } as CodexRpcNotification)
    }
  }

  disconnect() {
    this.connected = false
    for (const listener of this.connectionListeners) {
      listener('disconnected')
    }
  }
}

const createFixture = (input?: { playError?: Error, permissionError?: Error }) => {
  const rpc = new FakeRpcClient()
  const stream = new FakeStream()
  const peer = new FakePeerConnection()
  const audio = new FakeAudioElement()
  if (input?.playError) {
    audio.play.mockRejectedValue(input.playError)
  }
  const timers = new Set<() => void>()
  const environment: RealtimeBrowserEnvironment = {
    isSecureContext: () => true,
    supportsRealtime: () => true,
    getUserMedia: async () => {
      if (input?.permissionError) {
        throw input.permissionError
      }
      return stream
    },
    createPeerConnection: () => peer as unknown as ReturnType<RealtimeBrowserEnvironment['createPeerConnection']>,
    createAudioElement: () => audio,
    setTimeout: handler => {
      timers.add(handler)
      return 1 as unknown as ReturnType<typeof globalThis.setTimeout>
    },
    clearTimeout: () => {}
  }
  const controller = useRealtimeConversation({
    client: rpc,
    environment
  })

  return { rpc, stream, peer, audio, timers, controller }
}

const connectFixture = async (fixture: ReturnType<typeof createFixture>, threadId = 'thread-1') => {
  await fixture.controller.refreshCapability(threadId, true)
  await fixture.controller.connect(threadId)
  fixture.rpc.emit('thread/realtime/started', {
    threadId,
    realtimeSessionId: null,
    version: 'v1'
  })
  fixture.rpc.emit('thread/realtime/sdp', {
    threadId,
    sdp: 'answer-sdp'
  })
  await Promise.resolve()
  fixture.peer.connectionState = 'connected'
  fixture.peer.onconnectionstatechange?.()
  await Promise.resolve()
}

describe('realtime capability normalization', () => {
  it('keeps the Codori opt-in gate authoritative', () => {
    expect(resolveRealtimeCapability({
      configured: false,
      secureContext: true,
      browserSupported: true,
      response: enabledFeatureResponse
    }).status).toBe('disabled')
  })

  it('distinguishes insecure browsers, missing features, and RPC failures', () => {
    expect(resolveRealtimeCapability({
      configured: true,
      secureContext: false,
      browserSupported: true
    }).status).toBe('insecure-context')
    expect(resolveRealtimeCapability({
      configured: true,
      secureContext: true,
      browserSupported: true,
      response: { data: [], nextCursor: null }
    }).status).toBe('unsupported')
    expect(resolveRealtimeCapability({
      configured: true,
      secureContext: true,
      browserSupported: true,
      error: new Error('transport closed')
    }).status).toBe('failed')
  })
})

describe('realtime conversation controller', () => {
  it('negotiates browser-owned WebRTC with the exact app-server payload', async () => {
    const fixture = createFixture()

    await connectFixture(fixture)

    expect(fixture.rpc.requests).toContainEqual({
      method: 'thread/realtime/start',
      params: {
        threadId: 'thread-1',
        outputModality: 'audio',
        transport: {
          type: 'webrtc',
          sdp: 'offer-sdp'
        }
      }
    })
    expect(fixture.rpc.requests.some(request => request.method === 'turn/start')).toBe(false)
    expect(fixture.peer.addTrack).toHaveBeenCalledWith(fixture.stream.track, fixture.stream)
    expect(fixture.peer.createDataChannel).toHaveBeenCalledWith('oai-events')
    expect(fixture.peer.remoteDescription).toEqual({ type: 'answer', sdp: 'answer-sdp' })
    expect(fixture.controller.state.value).toBe('connected')
    expect(fixture.stream.track.enabled).toBe(false)

    fixture.controller.setMicrophoneEnabled(true)
    expect(fixture.stream.track.enabled).toBe(true)
    expect(fixture.controller.microphoneEnabled.value).toBe(true)
  })

  it('reconciles role transcripts without duplicating final text', async () => {
    const fixture = createFixture()
    await connectFixture(fixture)

    fixture.rpc.emit('thread/realtime/transcript/delta', {
      threadId: 'thread-1', role: 'user', delta: 'Run '
    })
    fixture.rpc.emit('thread/realtime/transcript/delta', {
      threadId: 'thread-1', role: 'user', delta: 'tests'
    })
    fixture.rpc.emit('thread/realtime/transcript/done', {
      threadId: 'thread-1', role: 'user', text: 'Run tests'
    })
    fixture.rpc.emit('thread/realtime/transcript/done', {
      threadId: 'thread-1', role: 'user', text: 'Run tests'
    })
    fixture.rpc.emit('thread/realtime/transcript/done', {
      threadId: 'thread-1', role: 'assistant', text: 'Starting now.'
    })

    expect(fixture.controller.transcripts.value.map(segment => ({
      role: segment.role,
      text: segment.text,
      final: segment.final
    }))).toEqual([
      { role: 'user', text: 'Run tests', final: true },
      { role: 'assistant', text: 'Starting now.', final: true }
    ])
    expect(fixture.controller.latestUserTranscript.value).toBe('Run tests')
  })

  it('attaches remote audio and reports an autoplay block', async () => {
    const fixture = createFixture({ playError: new Error('NotAllowedError') })
    await connectFixture(fixture)
    const remoteStream = new FakeStream()

    fixture.peer.ontrack?.({ streams: [remoteStream] })

    expect(fixture.audio.srcObject).toBe(remoteStream)
    expect(fixture.controller.remoteAudioActive.value).toBe(true)
    await vi.waitFor(() => {
      expect(fixture.controller.autoplayBlocked.value).toBe(true)
    })
  })

  it('stops tracks, media, subscriptions, and only the owned app-server session', async () => {
    const fixture = createFixture()
    await connectFixture(fixture)
    fixture.controller.setMicrophoneEnabled(true)

    await fixture.controller.stop()
    await fixture.controller.stop()

    expect(fixture.stream.track.stop).toHaveBeenCalledTimes(1)
    expect(fixture.peer.dataChannel.close).toHaveBeenCalledTimes(1)
    expect(fixture.peer.close).toHaveBeenCalledTimes(1)
    expect(fixture.audio.pause).toHaveBeenCalledTimes(1)
    expect(fixture.audio.srcObject).toBeNull()
    expect(fixture.rpc.requests.filter(request => request.method === 'thread/realtime/stop')).toEqual([{
      method: 'thread/realtime/stop',
      params: { threadId: 'thread-1' }
    }])
    expect(fixture.controller.state.value).toBe('closed')
  })

  it('deduplicates connection attempts for an already connected thread', async () => {
    const fixture = createFixture()
    await connectFixture(fixture)

    await fixture.controller.connect('thread-1')

    expect(fixture.rpc.requests.filter(request => request.method === 'thread/realtime/start')).toHaveLength(1)
  })

  it('tears down after an asynchronous realtime error', async () => {
    const fixture = createFixture()
    await connectFixture(fixture)

    fixture.rpc.emit('thread/realtime/error', {
      threadId: 'thread-1',
      message: 'account is not entitled to realtime'
    })
    await vi.waitFor(() => {
      expect(fixture.controller.state.value).toBe('error')
    })

    expect(fixture.controller.error.value).toBe('account is not entitled to realtime')
    expect(fixture.stream.track.stop).toHaveBeenCalledTimes(1)
    expect(fixture.rpc.requests.filter(request => request.method === 'thread/realtime/stop')).toHaveLength(1)
  })

  it('closes locally when the app-server reports transport closure', async () => {
    const fixture = createFixture()
    await connectFixture(fixture)

    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'transport_closed'
    })
    await vi.waitFor(() => {
      expect(fixture.controller.state.value).toBe('closed')
    })

    expect(fixture.rpc.requests.some(request => request.method === 'thread/realtime/stop')).toBe(false)
    expect(fixture.stream.track.stop).toHaveBeenCalledTimes(1)
  })

  it('bounds startup and stops a session that never connects', async () => {
    const fixture = createFixture()
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1')

    for (const timer of fixture.timers) {
      timer()
    }
    await vi.waitFor(() => {
      expect(fixture.controller.state.value).toBe('error')
    })

    expect(fixture.controller.error.value).toMatch(/Timed out/)
    expect(fixture.stream.track.stop).toHaveBeenCalledTimes(1)
    expect(fixture.rpc.requests.filter(request => request.method === 'thread/realtime/stop')).toHaveLength(1)
  })

  it('cleans up on RPC disconnect without trying to send stop', async () => {
    const fixture = createFixture()
    await connectFixture(fixture)

    fixture.rpc.disconnect()
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.controller.state.value).toBe('error')
    expect(fixture.controller.error.value).toMatch(/RPC connection closed/)
    expect(fixture.stream.track.stop).toHaveBeenCalledTimes(1)
    expect(fixture.rpc.requests.some(request => request.method === 'thread/realtime/stop')).toBe(false)
  })

  it('normalizes permission denial and partial startup cleanup', async () => {
    const fixture = createFixture({ permissionError: new Error('NotAllowedError: Permission denied') })
    await fixture.controller.refreshCapability('thread-1', true)

    await expect(fixture.controller.connect('thread-1')).rejects.toThrow(/Permission denied/)

    expect(fixture.controller.state.value).toBe('error')
    expect(fixture.controller.error.value).toMatch(/Microphone permission was denied/)
    expect(fixture.rpc.notificationListeners.size).toBe(0)
    expect(fixture.rpc.connectionListeners.size).toBe(0)
  })

  it('fails safely when microphone permission or the input device is lost', async () => {
    const fixture = createFixture()
    await connectFixture(fixture)

    fixture.stream.track.end()
    await vi.waitFor(() => {
      expect(fixture.controller.state.value).toBe('error')
    })

    expect(fixture.controller.error.value).toMatch(/Microphone access ended/)
    expect(fixture.stream.track.stop).toHaveBeenCalledTimes(1)
  })

  it('ignores old-generation notifications after a thread switch', async () => {
    const fixture = createFixture()
    await connectFixture(fixture)
    const oldListener = [...fixture.rpc.notificationListeners][0]!

    await fixture.controller.stopForThreadChange('thread-2')
    fixture.peer.connectionState = 'new'
    fixture.peer.close.mockClear()
    await fixture.controller.refreshCapability('thread-2', true)
    await fixture.controller.connect('thread-2')

    oldListener({
      method: 'thread/realtime/error',
      params: { threadId: 'thread-1', message: 'stale failure' }
    })

    expect(fixture.controller.owningThreadId.value).toBe('thread-2')
    expect(fixture.controller.error.value).toBeNull()
  })
})

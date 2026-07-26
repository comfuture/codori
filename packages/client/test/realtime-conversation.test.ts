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
  readonly addTransceiver = vi.fn()
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
  voicesResponse = {
    voices: {
      v1: ['juniper', 'cove'],
      v2: ['alloy'],
      defaultV1: 'cove',
      defaultV2: 'alloy'
    }
  }
  startError: Error | null = null
  startRequest: (() => Promise<void>) | null = null
  stopRequest: (() => Promise<void>) | null = null

  async request<T>(method: string, params?: unknown): Promise<T> {
    this.requests.push({ method, params })
    if (method === 'experimentalFeature/list') {
      return this.featureResponse as T
    }
    if (method === 'thread/realtime/listVoices') {
      return this.voicesResponse as T
    }
    if (method === 'thread/realtime/start' && this.startError) {
      throw this.startError
    }
    if (method === 'thread/realtime/start' && this.startRequest) {
      await this.startRequest()
    }
    if (method === 'thread/realtime/stop' && this.stopRequest) {
      await this.stopRequest()
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

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const createFixture = (input?: {
  playError?: Error
  permissionError?: Error
  streams?: FakeStream[]
  peers?: FakePeerConnection[]
  getUserMedia?: () => Promise<FakeStream>
}) => {
  const rpc = new FakeRpcClient()
  const streams = input?.streams ?? [new FakeStream()]
  const peers = input?.peers ?? [new FakePeerConnection()]
  const stream = streams[0]!
  const peer = peers[0]!
  const audio = new FakeAudioElement()
  if (input?.playError) {
    audio.play.mockRejectedValue(input.playError)
  }
  const timers = new Set<() => void>()
  const getUserMedia = vi.fn(input?.getUserMedia ?? (async () => {
    if (input?.permissionError) {
      throw input.permissionError
    }
    return stream
  }))
  let peerIndex = 0
  const environment: RealtimeBrowserEnvironment = {
    isSecureContext: () => true,
    supportsRealtime: () => true,
    getUserMedia,
    createPeerConnection: () =>
      (peers[peerIndex++] ?? peers.at(-1)!) as unknown as ReturnType<RealtimeBrowserEnvironment['createPeerConnection']>,
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

  return { rpc, stream, streams, peer, peers, audio, timers, getUserMedia, controller }
}

const connectFixture = async (fixture: ReturnType<typeof createFixture>, threadId = 'thread-1') => {
  await fixture.controller.refreshCapability(threadId, true)
  await fixture.controller.connect(threadId)
  fixture.rpc.emit('thread/realtime/started', {
    threadId,
    realtimeSessionId: null,
    version: 'v3'
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
  it('discovers and caches the advertised V1 voice catalog for V3', async () => {
    const fixture = createFixture()

    await fixture.controller.refreshVoiceCatalog()
    await fixture.controller.refreshVoiceCatalog()

    expect(fixture.rpc.requests.filter(request =>
      request.method === 'thread/realtime/listVoices'
    )).toEqual([{
      method: 'thread/realtime/listVoices',
      params: {}
    }])
    expect(fixture.controller.voiceCatalog.value).toEqual({
      status: 'ready',
      voices: ['juniper', 'cove'],
      protocolDefault: 'cove',
      error: null
    })
  })

  it('invalidates an idle catalog when the RPC connection epoch ends', async () => {
    const fixture = createFixture()
    await fixture.controller.refreshVoiceCatalog()

    fixture.rpc.disconnect()
    expect(fixture.controller.voiceCatalog.value.status).toBe('idle')

    fixture.rpc.connected = true
    fixture.rpc.voicesResponse.voices.v1 = ['juniper']
    await fixture.controller.refreshVoiceCatalog()
    expect(fixture.rpc.requests.filter(request =>
      request.method === 'thread/realtime/listVoices'
    )).toHaveLength(2)
    expect(fixture.controller.voiceCatalog.value.voices).toEqual(['juniper'])
  })

  it('requests microphone permission only when connect is invoked', async () => {
    const fixture = createFixture()

    await fixture.controller.refreshCapability('thread-1', true)
    expect(fixture.getUserMedia).not.toHaveBeenCalled()

    await fixture.controller.connect('thread-1')
    expect(fixture.getUserMedia).toHaveBeenCalledOnce()

    await fixture.controller.stop()
  })

  it('negotiates browser-owned V3 WebRTC with the exact app-server payload', async () => {
    const fixture = createFixture()

    await connectFixture(fixture)

    expect(fixture.rpc.requests).toContainEqual({
      method: 'thread/realtime/start',
      params: {
        threadId: 'thread-1',
        outputModality: 'audio',
        version: 'v3',
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

  it('sends only an explicitly selected advertised voice as a session override', async () => {
    const fixture = createFixture()
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', { voice: 'juniper' })

    expect(fixture.rpc.requests).toContainEqual({
      method: 'thread/realtime/start',
      params: {
        threadId: 'thread-1',
        outputModality: 'audio',
        version: 'v3',
        voice: 'juniper',
        transport: {
          type: 'webrtc',
          sdp: 'offer-sdp'
        }
      }
    })

    await fixture.controller.stop()
  })

  it('previews through receive-only WebRTC with a strict bound and no microphone', async () => {
    const fixture = createFixture()
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'Hello preview'
    })

    expect(fixture.getUserMedia).not.toHaveBeenCalled()
    expect(fixture.peer.addTrack).not.toHaveBeenCalled()
    expect(fixture.peer.addTransceiver).toHaveBeenCalledWith('audio', {
      direction: 'recvonly'
    })
    expect(fixture.peer.createDataChannel).toHaveBeenCalledWith('oai-events')
    expect(fixture.rpc.requests).toContainEqual({
      method: 'thread/realtime/start',
      params: {
        threadId: 'thread-1',
        outputModality: 'audio',
        version: 'v3',
        voice: 'cove',
        includeStartupContext: false,
        clientManagedHandoffs: true,
        transport: {
          type: 'webrtc',
          sdp: 'offer-sdp'
        }
      }
    })
    expect(fixture.rpc.requests.some(request => request.method === 'turn/start')).toBe(false)
    expect(fixture.rpc.requests.some(request =>
      request.method === 'thread/realtime/appendSpeech'
    )).toBe(false)

    fixture.rpc.emit('thread/realtime/started', {
      threadId: 'thread-1',
      realtimeSessionId: null,
      version: 'v3'
    })
    fixture.rpc.emit('thread/realtime/sdp', {
      threadId: 'thread-1',
      sdp: 'answer-sdp'
    })
    await Promise.resolve()
    fixture.peer.connectionState = 'connected'
    fixture.peer.onconnectionstatechange?.()
    await vi.waitFor(() => {
      expect(fixture.rpc.requests).toContainEqual({
        method: 'thread/realtime/appendSpeech',
        params: {
          threadId: 'thread-1',
          text: 'Hello preview'
        }
      })
    })
    expect(fixture.controller.previewStatus.value).toBe('playing')

    for (const timer of fixture.timers) {
      timer()
    }
    await vi.waitFor(() => {
      expect(fixture.controller.previewStatus.value).toBe('idle')
    })
    expect(fixture.peer.close).toHaveBeenCalledTimes(1)
    expect(fixture.rpc.requests.filter(request =>
      request.method === 'thread/realtime/stop'
    )).toHaveLength(1)
  })

  it('ignores late same-thread SDP and close notifications before replacement starts', async () => {
    const fixture = createFixture({
      peers: [new FakePeerConnection(), new FakePeerConnection()]
    })
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })
    const replacement = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/stop'
      )).toHaveLength(1)
    })
    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
    await replacement

    fixture.rpc.emit('thread/realtime/sdp', {
      threadId: 'thread-1',
      sdp: 'stale-answer'
    })
    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'replaced'
    })
    await Promise.resolve()

    expect(fixture.controller.owningThreadId.value).toBe('thread-1')
    expect(fixture.controller.activeVoice.value).toBe('juniper')
    expect(fixture.controller.state.value).toBe('starting')
    expect(fixture.peers[1]!.remoteDescription).toBeNull()

    await fixture.controller.stop()
  })

  it('waits for an in-flight teardown before initializing its replacement', async () => {
    const fixture = createFixture({
      peers: [new FakePeerConnection(), new FakePeerConnection()]
    })
    const stopResponse = deferred<void>()
    fixture.rpc.stopRequest = async () => await stopResponse.promise
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })

    const stop = fixture.controller.stop()
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/stop'
      )).toHaveLength(1)
    })
    const replacement = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })
    await Promise.resolve()
    expect(fixture.peers[1]!.createOffer).not.toHaveBeenCalled()

    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
    stopResponse.resolve()
    await Promise.all([stop, replacement])

    expect(fixture.controller.owningThreadId.value).toBe('thread-1')
    expect(fixture.controller.activeVoice.value).toBe('juniper')
    expect(fixture.controller.state.value).toBe('starting')
    await fixture.controller.stop()
  })

  it('disposes a preempted peer while serializing concurrent replacements', async () => {
    const fixture = createFixture({
      peers: [
        new FakePeerConnection(),
        new FakePeerConnection(),
        new FakePeerConnection()
      ]
    })
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })

    const firstReplacement = fixture.controller.connect('thread-2', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })
    const finalReplacement = fixture.controller.connect('thread-3', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'Third'
    })

    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/stop'
      )).toHaveLength(1)
    })
    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/stop'
      )).toHaveLength(2)
    })
    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-2',
      reason: 'client_request'
    })
    await Promise.all([firstReplacement, finalReplacement])

    expect(fixture.peers[1]!.close).toHaveBeenCalledTimes(1)
    expect(fixture.controller.owningThreadId.value).toBe('thread-3')
    expect(fixture.controller.activeVoice.value).toBe('cove')
    expect(fixture.controller.state.value).toBe('starting')
    await fixture.controller.stop()
  })

  it('serializes concurrent replacements waiting on the same teardown', async () => {
    const fixture = createFixture({
      peers: [
        new FakePeerConnection(),
        new FakePeerConnection(),
        new FakePeerConnection()
      ]
    })
    const stopResponse = deferred<void>()
    fixture.rpc.stopRequest = async () => await stopResponse.promise
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })

    const stop = fixture.controller.stop()
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/stop'
      )).toHaveLength(1)
    })
    const second = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })
    const third = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'Third'
    })

    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
    stopResponse.resolve()
    await stop
    await vi.waitFor(() => {
      expect(fixture.peers[1]!.createOffer).toHaveBeenCalledOnce()
    })
    expect(fixture.peers[2]!.createOffer).not.toHaveBeenCalled()
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/stop'
      )).toHaveLength(2)
    })

    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
    await Promise.all([second, third])

    expect(fixture.peers[1]!.close).toHaveBeenCalledOnce()
    expect(fixture.peers[2]!.createOffer).toHaveBeenCalledOnce()
    expect(fixture.controller.activeVoice.value).toBe('cove')
    fixture.rpc.disconnect()
  })

  it('does not let a duplicate pending connect block a later replacement', async () => {
    const fixture = createFixture({
      peers: [new FakePeerConnection(), new FakePeerConnection()]
    })
    const firstStart = deferred<void>()
    fixture.rpc.startRequest = async () => await firstStart.promise
    await fixture.controller.refreshCapability('thread-1', true)

    const first = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/start'
      )).toHaveLength(1)
    })
    const duplicate = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })
    const replacement = fixture.controller.connect('thread-2', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })

    await vi.waitFor(() => {
      expect(fixture.controller.owningThreadId.value).toBeNull()
    })
    firstStart.resolve()
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/stop'
      )).toHaveLength(1)
    })
    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
    fixture.rpc.startRequest = null
    await Promise.all([first, duplicate, replacement])

    expect(fixture.controller.owningThreadId.value).toBe('thread-2')
    expect(fixture.controller.activeVoice.value).toBe('juniper')
    await fixture.controller.stop()
  })

  it('does not let delayed start cleanup stop a same-thread replacement', async () => {
    const fixture = createFixture({
      peers: [new FakePeerConnection(), new FakePeerConnection()]
    })
    const firstStart = deferred<void>()
    fixture.rpc.startRequest = async () => await firstStart.promise
    await fixture.controller.refreshCapability('thread-1', true)

    const firstConnect = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/start'
      )).toHaveLength(1)
    })
    await fixture.controller.stop()
    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })

    fixture.rpc.startRequest = null
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })
    firstStart.resolve()
    await firstConnect
    await Promise.resolve()

    expect(fixture.rpc.requests.filter(request =>
      request.method === 'thread/realtime/stop'
    )).toHaveLength(0)
    expect(fixture.controller.owningThreadId.value).toBe('thread-1')
    expect(fixture.controller.activeVoice.value).toBe('juniper')
    await fixture.controller.stop()
  })

  it('does not let delayed rejected-start cleanup settle a newer barrier', async () => {
    const fixture = createFixture({
      peers: [new FakePeerConnection(), new FakePeerConnection(), new FakePeerConnection()]
    })
    const firstStart = deferred<void>()
    fixture.rpc.startRequest = async () => await firstStart.promise
    await fixture.controller.refreshCapability('thread-1', true)

    const firstConnect = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/start'
      )).toHaveLength(1)
    })
    await fixture.controller.stop()
    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })

    fixture.rpc.startRequest = null
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })
    await fixture.controller.stop()
    firstStart.reject(new Error('start rejected'))
    await firstConnect
    await Promise.resolve()

    for (const timer of fixture.timers) {
      timer()
    }
    await expect(fixture.controller.connect('thread-2', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'Third'
    })).rejects.toThrow(/did not confirm closure/)
  })

  it('compensates when stop wins a submitted realtime start request', async () => {
    const fixture = createFixture()
    const startResponse = deferred<void>()
    fixture.rpc.startRequest = async () => await startResponse.promise
    await fixture.controller.refreshCapability('thread-1', true)

    const connect = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'Deferred'
    })
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/start'
      )).toHaveLength(1)
    })
    const stop = fixture.controller.stop()
    expect(fixture.rpc.requests.some(request =>
      request.method === 'thread/realtime/stop'
    )).toBe(false)
    await vi.waitFor(() => {
      expect(fixture.controller.owningThreadId.value).toBeNull()
    })
    await stop
    expect(fixture.controller.state.value).toBe('closed')

    startResponse.resolve()
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.filter(request =>
        request.method === 'thread/realtime/stop'
      )).toHaveLength(1)
    })
    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
    await connect

    expect(fixture.controller.owningThreadId.value).toBeNull()
    expect(fixture.controller.state.value).toBe('closed')
  })

  it('fails closed without retaining ownership when a submitted start never responds', async () => {
    const fixture = createFixture({
      peers: [new FakePeerConnection(), new FakePeerConnection()]
    })
    const startResponse = deferred<void>()
    fixture.rpc.startRequest = async () => await startResponse.promise
    await fixture.controller.refreshCapability('thread-1', true)

    const pendingConnect = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'Pending'
    })
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.some(request =>
        request.method === 'thread/realtime/start'
      )).toBe(true)
    })
    await fixture.controller.stop()
    expect(fixture.controller.owningThreadId.value).toBeNull()

    for (const timer of fixture.timers) {
      timer()
    }
    await expect(fixture.controller.connect('thread-2', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Blocked'
    })).rejects.toThrow(/did not confirm closure/)
    expect(fixture.rpc.requests.filter(request =>
      request.method === 'thread/realtime/start'
    )).toHaveLength(1)

    fixture.rpc.disconnect()
    startResponse.resolve()
    await pendingConnect
  })

  it('withholds a new session until an explicitly stopped session confirms closure', async () => {
    const fixture = createFixture({
      peers: [new FakePeerConnection(), new FakePeerConnection()]
    })
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })
    await fixture.controller.stop()

    const next = fixture.controller.connect('thread-2', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })
    await Promise.resolve()
    expect(fixture.rpc.requests.filter(request =>
      request.method === 'thread/realtime/start'
    )).toHaveLength(1)
    expect(fixture.peers[1]!.createOffer).not.toHaveBeenCalled()

    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
    await next

    expect(fixture.rpc.requests.filter(request =>
      request.method === 'thread/realtime/start'
    )).toHaveLength(2)
    await fixture.controller.stop()
  })

  it('fails closed when the previous session never confirms closure', async () => {
    const fixture = createFixture({
      peers: [new FakePeerConnection(), new FakePeerConnection()]
    })
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'First'
    })
    await fixture.controller.stop()

    for (const timer of fixture.timers) {
      timer()
    }
    await expect(fixture.controller.connect('thread-2', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })).rejects.toThrow(/did not confirm closure/)
    expect(fixture.rpc.requests.filter(request =>
      request.method === 'thread/realtime/start'
    )).toHaveLength(1)

    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
    await fixture.controller.connect('thread-2', {
      kind: 'preview',
      voice: 'juniper',
      previewText: 'Second'
    })
    expect(fixture.rpc.requests.filter(request =>
      request.method === 'thread/realtime/start'
    )).toHaveLength(2)
    await fixture.controller.stop()
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

  it('reports autoplay denial as a blocked preview instead of successful playback', async () => {
    const fixture = createFixture({ playError: new Error('NotAllowedError') })
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'Hello preview'
    })
    fixture.rpc.emit('thread/realtime/started', {
      threadId: 'thread-1',
      realtimeSessionId: null,
      version: 'v3'
    })
    fixture.rpc.emit('thread/realtime/sdp', {
      threadId: 'thread-1',
      sdp: 'answer-sdp'
    })
    fixture.peer.connectionState = 'connected'
    fixture.peer.onconnectionstatechange?.()
    fixture.peer.ontrack?.({ streams: [new FakeStream()] })

    await vi.waitFor(() => {
      expect(fixture.controller.previewStatus.value).toBe('blocked')
    })
    expect(fixture.controller.previewError.value).toMatch(/autoplay blocked/)

    fixture.audio.play.mockResolvedValue()
    await fixture.controller.setOutputMuted(false)
    expect(fixture.controller.autoplayBlocked.value).toBe(false)
    expect(fixture.controller.previewError.value).toBeNull()

    await fixture.controller.stop()
    expect(fixture.controller.previewStatus.value).toBe('idle')
  })

  it('clears an autoplay-denied preview error when the user stops the preview', async () => {
    const fixture = createFixture({ playError: new Error('NotAllowedError') })
    await fixture.controller.refreshCapability('thread-1', true)
    await fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'Hello preview'
    })
    fixture.rpc.emit('thread/realtime/started', {
      threadId: 'thread-1',
      realtimeSessionId: null,
      version: 'v3'
    })
    fixture.rpc.emit('thread/realtime/sdp', {
      threadId: 'thread-1',
      sdp: 'answer-sdp'
    })
    fixture.peer.connectionState = 'connected'
    fixture.peer.onconnectionstatechange?.()
    fixture.peer.ontrack?.({ streams: [new FakeStream()] })

    await vi.waitFor(() => {
      expect(fixture.controller.previewStatus.value).toBe('blocked')
    })

    await fixture.controller.stop()

    expect(fixture.controller.autoplayBlocked.value).toBe(false)
    expect(fixture.controller.previewError.value).toBeNull()
    expect(fixture.controller.previewStatus.value).toBe('idle')
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

  it('does not let a stale permission request replace the active media stream', async () => {
    const stalePermission = deferred<FakeStream>()
    const staleStream = new FakeStream()
    const activeStream = new FakeStream()
    let permissionRequest = 0
    const fixture = createFixture({
      streams: [staleStream, activeStream],
      getUserMedia: async () => ++permissionRequest === 1
        ? await stalePermission.promise
        : activeStream
    })
    await fixture.controller.refreshCapability('thread-1', true)

    const staleConnect = fixture.controller.connect('thread-1')
    await vi.waitFor(() => expect(fixture.getUserMedia).toHaveBeenCalledTimes(1))
    const activeConnect = fixture.controller.connect('thread-2')
    await vi.waitFor(() => expect(fixture.getUserMedia).toHaveBeenCalledTimes(2))
    await activeConnect

    stalePermission.resolve(staleStream)
    await staleConnect

    expect(staleStream.track.stop).toHaveBeenCalledTimes(1)
    expect(activeStream.track.stop).not.toHaveBeenCalled()

    await fixture.controller.stop()

    expect(activeStream.track.stop).toHaveBeenCalledTimes(1)
  })

  it('does not let a stale offer mutate the active peer connection', async () => {
    const staleOffer = deferred<{ type: 'offer', sdp: string }>()
    const stalePeer = new FakePeerConnection()
    const activePeer = new FakePeerConnection()
    stalePeer.createOffer.mockImplementation(async () => await staleOffer.promise)
    const streams = [new FakeStream(), new FakeStream()]
    let permissionRequest = 0
    const fixture = createFixture({
      streams,
      peers: [stalePeer, activePeer],
      getUserMedia: async () => streams[permissionRequest++]!
    })
    await fixture.controller.refreshCapability('thread-1', true)

    const staleConnect = fixture.controller.connect('thread-1')
    await vi.waitFor(() => expect(stalePeer.createOffer).toHaveBeenCalledOnce())
    const activeConnect = fixture.controller.connect('thread-2')
    await activeConnect

    staleOffer.resolve({ type: 'offer', sdp: 'stale-offer-sdp' })
    await staleConnect

    expect(stalePeer.setLocalDescription).not.toHaveBeenCalled()
    expect(activePeer.setLocalDescription).toHaveBeenCalledOnce()
    expect(activePeer.setLocalDescription).toHaveBeenCalledWith({
      type: 'offer',
      sdp: 'offer-sdp'
    })

    await fixture.controller.stop()
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

  it('does not wait on an in-flight start after the RPC transport disconnects', async () => {
    const fixture = createFixture()
    const startResponse = deferred<void>()
    fixture.rpc.startRequest = async () => await startResponse.promise
    await fixture.controller.refreshCapability('thread-1', true)

    const connect = fixture.controller.connect('thread-1', {
      kind: 'preview',
      voice: 'cove',
      previewText: 'Disconnect'
    })
    await vi.waitFor(() => {
      expect(fixture.rpc.requests.some(request =>
        request.method === 'thread/realtime/start'
      )).toBe(true)
    })
    fixture.rpc.disconnect()

    await vi.waitFor(() => {
      expect(fixture.controller.state.value).toBe('closed')
    })
    expect(fixture.controller.previewError.value).toMatch(/RPC connection closed/)
    expect(fixture.rpc.requests.some(request =>
      request.method === 'thread/realtime/stop'
    )).toBe(false)

    startResponse.resolve()
    await connect
  })

  it('normalizes permission denial and partial startup cleanup', async () => {
    const fixture = createFixture({ permissionError: new Error('NotAllowedError: Permission denied') })
    await fixture.controller.refreshCapability('thread-1', true)

    await expect(fixture.controller.connect('thread-1')).rejects.toThrow(/Permission denied/)

    expect(fixture.controller.state.value).toBe('error')
    expect(fixture.controller.error.value).toMatch(/Microphone permission was denied/)
    expect(fixture.rpc.notificationListeners.size).toBe(0)
    expect(fixture.rpc.connectionListeners.size).toBe(1)
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
    fixture.rpc.emit('thread/realtime/closed', {
      threadId: 'thread-1',
      reason: 'client_request'
    })
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

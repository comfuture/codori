// @vitest-environment jsdom

import { computed, nextTick, ref, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useRealtimeVoiceCapabilityLifecycle } from '../app/composables/useRealtimeVoiceCapabilityLifecycle'
import {
  isRealtimeVoiceActiveElsewhere,
  useActiveRealtimeConversation,
  useSharedRealtimeConversation
} from '../app/composables/useSharedRealtimeConversation'
import type {
  CodexRpcClient,
  CodexRpcConnectionState,
  CodexRpcNotification
} from '../shared/codex-rpc'

const enabledFeatureResponse = {
  data: [{
    name: 'realtime_conversation',
    stage: 'underDevelopment',
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
  addEventListener = vi.fn()
  removeEventListener = vi.fn()
}

class FakeMediaStream {
  readonly track = new FakeTrack()

  getAudioTracks() {
    return [this.track]
  }

  getTracks() {
    return [this.track]
  }
}

class FakePeerConnection {
  static events: string[] = []

  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescriptionInit | null = null
  ontrack = null
  onconnectionstatechange = null
  addTrack = vi.fn()
  addTransceiver = vi.fn()
  createDataChannel = vi.fn(() => ({ close: vi.fn() }))
  createOffer = vi.fn(async () => {
    FakePeerConnection.events.push('create-offer')
    return { type: 'offer' as const, sdp: 'offer-sdp' }
  })
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = description
  })
  setRemoteDescription = vi.fn(async () => {})
  close = vi.fn(() => {
    this.connectionState = 'closed'
  })
}

class FakeRpcClient {
  readonly requests: Array<{ method: string, params: unknown }> = []
  readonly notificationListeners = new Set<(notification: CodexRpcNotification) => void>()
  readonly connectionListeners = new Set<(state: CodexRpcConnectionState) => void>()

  async request<T>(method: string, params?: unknown): Promise<T> {
    this.requests.push({ method, params })
    if (method === 'experimentalFeature/list') {
      return enabledFeatureResponse as T
    }
    if (method === 'thread/realtime/listVoices') {
      return {
        voices: {
          v1: ['cove'],
          v2: [],
          defaultV1: 'cove',
          defaultV2: null
        }
      } as T
    }
    if (method === 'thread/realtime/start') {
      FakePeerConnection.events.push('realtime-start')
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
    return true
  }

  emit(method: CodexRpcNotification['method'], params: Record<string, unknown>) {
    for (const listener of this.notificationListeners) {
      listener({ method, params } as CodexRpcNotification)
    }
  }
}

const settle = async () => {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('realtime voice startup ownership handoff', () => {
  it('starts realtime voice from a completed non-voice thread after route capability recovery', async () => {
    const events: string[] = []
    FakePeerConnection.events = events
    const stream = new FakeMediaStream()
    const getUserMedia = vi.fn(async () => {
      events.push('get-user-media')
      return stream
    })
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})

    const threadId = 'thread-completed-without-voice'
    const workspaceKey = 'project:completed-without-voice'
    const rpc = new FakeRpcClient()
    const conversation = useSharedRealtimeConversation(
      workspaceKey,
      () => rpc as unknown as CodexRpcClient
    )
    const activeThreadId = ref<string | null>(threadId)
    const rpcConnectionEpoch = ref(0)
    const contextEpoch = ref(0)
    const refreshThreadCapability = vi.fn(async (nextThreadId: string) => {
      await conversation.refreshCapability(nextThreadId, true)
    })
    useRealtimeVoiceCapabilityLifecycle({
      activeThreadId,
      rpcConnectionEpoch,
      contextEpoch,
      activeElsewhere: computed(() => false),
      capability: conversation.capability,
      cancelPendingRefresh: vi.fn(),
      refreshThreadCapability,
      refreshDraftCatalog: vi.fn(async () => {})
    })
    await settle()

    conversation.capability.value = {
      status: 'failed',
      message: 'The cached route capability probe used a closed socket.'
    }
    contextEpoch.value += 1
    await settle()

    expect(refreshThreadCapability).toHaveBeenCalledTimes(2)
    expect(conversation.capability.value.status).toBe('available')
    expect(conversation.state.value).toBe('idle')

    await conversation.connect(threadId)

    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(events).toEqual([
      'get-user-media',
      'create-offer',
      'realtime-start'
    ])
    expect(rpc.requests.filter(request =>
      request.method === 'thread/realtime/start'
    )).toHaveLength(1)

    await conversation.stop()
    rpc.emit('thread/realtime/closed', {
      threadId,
      reason: 'user'
    })
    await settle()
  })

  it('keeps the verified capability through the shared claim and starts exactly once', async () => {
    const events: string[] = []
    FakePeerConnection.events = events
    const stream = new FakeMediaStream()
    const getUserMedia = vi.fn(async () => {
      events.push('get-user-media')
      return stream
    })
    Object.defineProperty(window, 'isSecureContext', {
      configurable: true,
      value: true
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })
    vi.stubGlobal('RTCPeerConnection', FakePeerConnection)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})

    const threadId = 'thread-issue-100'
    const workspaceKey = 'project:issue-100'
    const rpc = new FakeRpcClient()
    const conversation = useSharedRealtimeConversation(
      workspaceKey,
      () => rpc as unknown as CodexRpcClient
    )
    const activeThreadId = ref<string | null>(threadId)
    const rpcConnectionEpoch = ref(0)
    const contextEpoch = ref(0)
    const activeElsewhere = computed(() =>
      isRealtimeVoiceActiveElsewhere({
        activeWorkspaceKey: conversation.activeWorkspaceKey.value,
        activeThreadId: conversation.owningThreadId.value,
        workspaceKey,
        threadId: activeThreadId.value
      })
    )
    const refreshThreadCapability = vi.fn(async (nextThreadId: string) => {
      await conversation.refreshCapability(nextThreadId, true)
    })
    useRealtimeVoiceCapabilityLifecycle({
      activeThreadId,
      rpcConnectionEpoch,
      contextEpoch,
      activeElsewhere,
      capability: conversation.capability,
      cancelPendingRefresh: vi.fn(),
      refreshThreadCapability,
      refreshDraftCatalog: vi.fn(async () => {})
    })
    await settle()
    expect(conversation.capability.value.status).toBe('available')
    expect(refreshThreadCapability).toHaveBeenCalledOnce()

    const capabilityStatuses: string[] = []
    const releaseCapabilityWatch = watch(
      () => conversation.capability.value.status,
      status => capabilityStatuses.push(status),
      { flush: 'sync' }
    )

    await conversation.connect(threadId)

    expect(capabilityStatuses).not.toContain('checking')
    expect(conversation.capability.value.status).toBe('available')
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(events).toEqual([
      'get-user-media',
      'create-offer',
      'realtime-start'
    ])
    expect(rpc.requests.filter(request =>
      request.method === 'thread/realtime/start'
    )).toHaveLength(1)
    expect(refreshThreadCapability).toHaveBeenCalledOnce()

    const otherRpc = new FakeRpcClient()
    const otherConversation = useSharedRealtimeConversation(
      'project:issue-100-other',
      () => otherRpc as unknown as CodexRpcClient
    )
    await expect(otherConversation.connect('thread-other'))
      .rejects.toThrow('A voice session is already active in another thread.')
    expect(otherRpc.requests.some(request =>
      request.method === 'thread/realtime/start'
    )).toBe(false)

    await conversation.stop()
    rpc.emit('thread/realtime/closed', {
      threadId,
      reason: 'user'
    })
    await settle()
    expect(useActiveRealtimeConversation().activeThreadId.value).toBeNull()

    rpcConnectionEpoch.value += 1
    await settle()
    expect(refreshThreadCapability).toHaveBeenCalledTimes(2)

    conversation.capability.value = {
      status: 'failed',
      message: 'The previous route probe used a disconnected transport.'
    }
    contextEpoch.value += 1
    await settle()
    expect(refreshThreadCapability).toHaveBeenCalledTimes(3)
    expect(conversation.capability.value.status).toBe('available')

    releaseCapabilityWatch()
  })
})

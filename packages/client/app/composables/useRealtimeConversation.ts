import { computed, ref } from 'vue'
import type { CodexRpcClient, CodexRpcNotification } from '~~/shared/codex-rpc'
import type { ExperimentalFeatureListResponse } from '~~/shared/generated/codex-app-server/v2/ExperimentalFeatureListResponse'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'
import type { ThreadRealtimeClosedNotification } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeClosedNotification'
import type { ThreadRealtimeErrorNotification } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeErrorNotification'
import type { ThreadRealtimeListVoicesResponse } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeListVoicesResponse'
import type { ThreadRealtimeSdpNotification } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeSdpNotification'
import type { ThreadRealtimeStartedNotification } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeStartedNotification'
import type { ThreadRealtimeStartParams } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeStartParams'
import type { ThreadRealtimeTranscriptDeltaNotification } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeTranscriptDeltaNotification'
import type { ThreadRealtimeTranscriptDoneNotification } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeTranscriptDoneNotification'

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

export type RealtimeTranscriptRole = 'user' | 'assistant' | 'unknown'

export type RealtimeTranscriptSegment = {
  id: number
  generation: number
  role: RealtimeTranscriptRole
  text: string
  final: boolean
}

export type RealtimeCapability = {
  status: RealtimeCapabilityStatus
  message: string
}

type RealtimeTrack = {
  enabled: boolean
  stop: () => void
  addEventListener?: (type: 'ended', listener: () => void) => void
  removeEventListener?: (type: 'ended', listener: () => void) => void
}

type RealtimeMediaStream = {
  getAudioTracks: () => RealtimeTrack[]
  getTracks: () => RealtimeTrack[]
}

type RealtimeDataChannel = {
  close: () => void
}

type RealtimeAudioElement = {
  autoplay: boolean
  muted: boolean
  srcObject: RealtimeMediaStream | null
  play: () => Promise<void>
  pause: () => void
}

type RealtimePeerConnection = {
  connectionState: RTCPeerConnectionState
  localDescription: RTCSessionDescriptionInit | null
  ontrack: ((event: { streams: RealtimeMediaStream[] }) => void) | null
  onconnectionstatechange: (() => void) | null
  addTrack: (track: RealtimeTrack, stream: RealtimeMediaStream) => unknown
  addTransceiver: (kind: 'audio', init: { direction: 'recvonly' }) => unknown
  createDataChannel: (label: string) => RealtimeDataChannel
  createOffer: () => Promise<RTCSessionDescriptionInit>
  setLocalDescription: (description: RTCSessionDescriptionInit) => Promise<void>
  setRemoteDescription: (description: RTCSessionDescriptionInit) => Promise<void>
  close: () => void
}

export type RealtimeBrowserEnvironment = {
  isSecureContext: () => boolean
  supportsRealtime: () => boolean
  getUserMedia: () => Promise<RealtimeMediaStream>
  createPeerConnection: () => RealtimePeerConnection
  createAudioElement: () => RealtimeAudioElement
  setTimeout: (handler: () => void, timeoutMs: number) => ReturnType<typeof globalThis.setTimeout>
  clearTimeout: (timer: ReturnType<typeof globalThis.setTimeout>) => void
}

type RealtimeRpcClient = Pick<
  CodexRpcClient,
  'request' | 'subscribe' | 'subscribeConnectionState' | 'isConnected'
>

type ControllerOptions = {
  client: RealtimeRpcClient
  environment?: RealtimeBrowserEnvironment
  connectionTimeoutMs?: number
}

type PendingStartRequest = {
  generation: number
  threadId: string
  accepted: Promise<boolean>
}

type PendingCloseBarrier = {
  status: 'pending' | 'timed-out' | 'closed'
  promise: Promise<void>
  settle: () => void
  release: () => void
  timer: ReturnType<typeof globalThis.setTimeout>
}

const DEFAULT_CONNECTION_TIMEOUT_MS = 20_000
const DEFAULT_PREVIEW_TIMEOUT_MS = 12_000
const REPLACEMENT_CLOSE_TIMEOUT_MS = 1_500

export type RealtimeConnectOptions = {
  voice?: RealtimeVoice
  kind?: RealtimeSessionKind
  previewText?: string
  previewTimeoutMs?: number
}

const defaultEnvironment = (): RealtimeBrowserEnvironment => ({
  isSecureContext: () => window.isSecureContext,
  supportsRealtime: () =>
    typeof RTCPeerConnection !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function',
  getUserMedia: async () =>
    await navigator.mediaDevices.getUserMedia({ audio: true }) as unknown as RealtimeMediaStream,
  createPeerConnection: () => new RTCPeerConnection() as unknown as RealtimePeerConnection,
  createAudioElement: () => document.createElement('audio') as unknown as RealtimeAudioElement,
  setTimeout: (handler, timeoutMs) => globalThis.setTimeout(handler, timeoutMs),
  clearTimeout: timer => globalThis.clearTimeout(timer)
})

const normalizeRole = (role: string): RealtimeTranscriptRole =>
  role === 'user' || role === 'assistant' ? role : 'unknown'

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

export const useRealtimeConversation = (options: ControllerOptions) => {
  const environment = options.environment ?? defaultEnvironment()
  const connectionTimeoutMs = options.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS
  const capability = ref<RealtimeCapability>({
    status: 'checking',
    message: 'Checking realtime voice support.'
  })
  const state = ref<RealtimeSessionState>('idle')
  const activity = ref<RealtimeActivity>('idle')
  const sessionKind = ref<RealtimeSessionKind | null>(null)
  const activeVoice = ref<RealtimeVoice | null>(null)
  const owningThreadId = ref<string | null>(null)
  const generation = ref(0)
  const transcripts = ref<RealtimeTranscriptSegment[]>([])
  const error = ref<string | null>(null)
  const outputMuted = ref(false)
  const autoplayBlocked = ref(false)
  const microphoneEnabled = ref(false)
  const remoteAudioActive = ref(false)
  const peerConnectionState = ref<RTCPeerConnectionState | null>(null)
  const voiceCatalog = ref<RealtimeVoiceCatalog>({
    status: 'idle',
    voices: [],
    protocolDefault: null,
    error: null
  })
  const previewError = ref<string | null>(null)
  const previewStatus = computed<RealtimeVoicePreviewStatus>(() => {
    if (sessionKind.value === 'preview') {
      if (state.value === 'stopping') {
        return 'stopping'
      }
      if (autoplayBlocked.value) {
        return 'blocked'
      }
      return state.value === 'connected' ? 'playing' : 'loading'
    }
    return previewError.value ? 'error' : 'idle'
  })
  const latestUserTranscript = computed(() =>
    transcripts.value.findLast(segment => segment.role === 'user' && segment.final)?.text ?? null
  )

  let generationCounter = 0
  let capabilityProbeCounter = 0
  let voiceCatalogProbeCounter = 0
  let transcriptCounter = 0
  let activeGeneration: number | null = null
  let mediaStream: RealtimeMediaStream | null = null
  let microphoneTrack: RealtimeTrack | null = null
  let peerConnection: RealtimePeerConnection | null = null
  let dataChannel: RealtimeDataChannel | null = null
  let audioElement: RealtimeAudioElement | null = null
  let releaseNotifications: (() => void) | null = null
  let releaseMicrophoneEnded: (() => void) | null = null
  let connectionTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let previewTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let startPromise: Promise<void> | null = null
  let pendingStartRequest: PendingStartRequest | null = null
  let teardownPromise: Promise<void> | null = null
  let releasePersistentConnection: (() => void) | null = null
  let startedReceived = false
  let remoteDescriptionApplied = false
  let pendingSdp: string | null = null
  let startAccepted = false
  let previewSpeechRequested = false
  let activePreviewText: string | null = null
  let activePreviewTimeoutMs = DEFAULT_PREVIEW_TIMEOUT_MS
  const pendingCloseBarriers = new Map<string, PendingCloseBarrier>()

  const isCurrent = (candidateGeneration: number, threadId?: string) =>
    activeGeneration === candidateGeneration
    && (!threadId || owningThreadId.value === threadId)

  const clearConnectionTimer = () => {
    if (connectionTimer === null) {
      return
    }
    environment.clearTimeout(connectionTimer)
    connectionTimer = null
  }

  const clearPreviewTimers = () => {
    if (previewTimer !== null) {
      environment.clearTimeout(previewTimer)
      previewTimer = null
    }
  }

  const invalidateVoiceCatalog = () => {
    voiceCatalogProbeCounter += 1
    voiceCatalog.value = {
      status: 'idle',
      voices: [],
      protocolDefault: null,
      error: null
    }
  }

  const clearPendingCloseBarriers = () => {
    for (const [threadId, barrier] of pendingCloseBarriers) {
      environment.clearTimeout(barrier.timer)
      barrier.release()
      if (barrier.status === 'pending') {
        // A disconnected RPC transport also terminates its server-side session.
        // Resolve pending waiters so a later connection epoch can start cleanly.
        barrier.status = 'closed'
        barrier.settle()
      } else {
        barrier.status = 'closed'
      }
      pendingCloseBarriers.delete(threadId)
    }
  }

  const ensureConnectionMonitor = () => {
    if (releasePersistentConnection) {
      return
    }
    releasePersistentConnection = options.client.subscribeConnectionState((connectionState) => {
      if (connectionState !== 'disconnected') {
        return
      }
      invalidateVoiceCatalog()
      clearPendingCloseBarriers()
      if (activeGeneration !== null) {
        void fail(activeGeneration, 'The Codex RPC connection closed.', false)
      }
    })
  }

  const createPendingCloseBarrier = (threadId: string) => {
    const existing = pendingCloseBarriers.get(threadId)
    if (existing) {
      return existing
    }

    let resolveClosed!: () => void
    let rejectTimedOut!: (error: Error) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolveClosed = resolve
      rejectTimedOut = reject
    })
    const barrier: PendingCloseBarrier = {
      status: 'pending',
      promise,
      settle: resolveClosed,
      release: () => {},
      timer: 0 as unknown as ReturnType<typeof globalThis.setTimeout>
    }
    const release = options.client.subscribe((notification) => {
      const params = notification.params as { threadId?: unknown } | undefined
      if (notification.method !== 'thread/realtime/closed'
        || params?.threadId !== threadId) {
        return
      }

      environment.clearTimeout(barrier.timer)
      barrier.release()
      pendingCloseBarriers.delete(threadId)
      if (barrier.status === 'pending') {
        barrier.status = 'closed'
        resolveClosed()
      } else {
        barrier.status = 'closed'
      }
    })
    barrier.release = release
    const timer = environment.setTimeout(() => {
      if (barrier.status !== 'pending') {
        return
      }
      barrier.status = 'timed-out'
      rejectTimedOut(new Error(
        `Timed out waiting for the previous realtime voice session on ${threadId} to close.`
      ))
    }, REPLACEMENT_CLOSE_TIMEOUT_MS)
    barrier.timer = timer
    // A regular stop does not await this barrier. Mark the rejection handled
    // while preserving it for the next start, which must fail closed.
    void promise.catch(() => {})
    pendingCloseBarriers.set(threadId, barrier)
    return barrier
  }

  const awaitPendingCloseBarriers = async () => {
    for (const barrier of pendingCloseBarriers.values()) {
      if (barrier.status === 'timed-out') {
        throw new Error(
          'The previous realtime voice session did not confirm closure. Reconnect Codex before starting another session.'
        )
      }
      await barrier.promise
    }
  }

  const refreshVoiceCatalog = async (force = false) => {
    ensureConnectionMonitor()
    if (!force && voiceCatalog.value.status === 'ready') {
      return voiceCatalog.value
    }

    const probeGeneration = ++voiceCatalogProbeCounter
    voiceCatalog.value = {
      ...voiceCatalog.value,
      status: 'loading',
      error: null
    }

    try {
      const response = await options.client.request<ThreadRealtimeListVoicesResponse>(
        'thread/realtime/listVoices',
        {}
      )
      if (probeGeneration === voiceCatalogProbeCounter) {
        voiceCatalog.value = {
          status: 'ready',
          voices: [...response.voices.v1],
          protocolDefault: response.voices.defaultV1,
          error: null
        }
      }
    } catch (caughtError) {
      if (probeGeneration === voiceCatalogProbeCounter) {
        voiceCatalog.value = {
          status: 'error',
          voices: [],
          protocolDefault: null,
          error: `Could not load realtime voices: ${errorMessage(caughtError)}`
        }
      }
    }

    return voiceCatalog.value
  }

  const reconcileTranscriptDelta = (
    candidateGeneration: number,
    roleValue: string,
    delta: string
  ) => {
    if (!isCurrent(candidateGeneration) || !startedReceived || !delta) {
      return
    }

    const role = normalizeRole(roleValue)
    const index = transcripts.value.findLastIndex(segment =>
      segment.generation === candidateGeneration
      && segment.role === role
      && !segment.final
    )
    if (index === -1) {
      transcripts.value = [...transcripts.value, {
        id: ++transcriptCounter,
        generation: candidateGeneration,
        role,
        text: delta,
        final: false
      }]
    } else {
      transcripts.value = transcripts.value.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, text: `${segment.text}${delta}` } : segment
      )
    }

    activity.value = role === 'user' ? 'transcribing' : role === 'assistant' ? 'speaking' : activity.value
  }

  const reconcileTranscriptDone = (
    candidateGeneration: number,
    roleValue: string,
    text: string
  ) => {
    if (!isCurrent(candidateGeneration) || !startedReceived) {
      return
    }

    const role = normalizeRole(roleValue)
    const index = transcripts.value.findLastIndex(segment =>
      segment.generation === candidateGeneration
      && segment.role === role
      && !segment.final
    )
    if (index !== -1) {
      transcripts.value = transcripts.value.map((segment, segmentIndex) =>
        segmentIndex === index ? { ...segment, text, final: true } : segment
      )
    } else {
      const previous = transcripts.value.at(-1)
      if (!(previous?.generation === candidateGeneration
        && previous.role === role
        && previous.final
        && previous.text === text)) {
        transcripts.value = [...transcripts.value, {
          id: ++transcriptCounter,
          generation: candidateGeneration,
          role,
          text,
          final: true
        }]
      }
    }

    if (role === 'assistant') {
      activity.value = 'speaking'
    } else if (role === 'user') {
      activity.value = 'transcribing'
    }
  }

  const maybeMarkConnected = (candidateGeneration: number) => {
    if (!isCurrent(candidateGeneration)
      || !startedReceived
      || !remoteDescriptionApplied
      || peerConnection?.connectionState !== 'connected') {
      return
    }

    clearConnectionTimer()
    state.value = 'connected'
    activity.value = microphoneEnabled.value ? 'listening' : 'idle'

    if (sessionKind.value !== 'preview'
      || previewSpeechRequested
      || !activePreviewText) {
      return
    }

    previewSpeechRequested = true
    const threadId = owningThreadId.value
    if (!threadId) {
      void fail(candidateGeneration, 'The preview thread is no longer available.')
      return
    }

    previewTimer = environment.setTimeout(() => {
      if (isCurrent(candidateGeneration, threadId) && sessionKind.value === 'preview') {
        void teardown({
          candidateGeneration,
          sendStop: true,
          terminalState: 'closed'
        })
      }
    }, activePreviewTimeoutMs)

    void options.client.request('thread/realtime/appendSpeech', {
      threadId,
      text: activePreviewText
    }).then(() => {
      // The current app-server contract has no output-playout completion event.
      // The authoritative preview bound remains armed until explicit stop/teardown.
    }).catch((caughtError) => {
      if (isCurrent(candidateGeneration, threadId)) {
        void fail(
          candidateGeneration,
          `Could not play the voice preview: ${errorMessage(caughtError)}`
        )
      }
    })
  }

  const teardown = async (input: {
    candidateGeneration: number
    sendStop: boolean
    terminalState: 'closed' | 'error'
    message?: string | null
  }) => {
    if (!isCurrent(input.candidateGeneration)) {
      return
    }
    if (teardownPromise) {
      return await teardownPromise
    }

    teardownPromise = (async () => {
      const threadId = owningThreadId.value
      const submittedStart = pendingStartRequest?.generation === input.candidateGeneration
        ? pendingStartRequest
        : null
      activeGeneration = null
      clearConnectionTimer()
      clearPreviewTimers()
      releaseNotifications?.()
      releaseNotifications = null
      releaseMicrophoneEnded?.()
      releaseMicrophoneEnded = null
      microphoneEnabled.value = false

      for (const track of mediaStream?.getTracks() ?? []) {
        track.enabled = false
        track.stop()
      }
      mediaStream = null
      microphoneTrack = null

      dataChannel?.close()
      dataChannel = null
      if (peerConnection) {
        peerConnection.ontrack = null
        peerConnection.onconnectionstatechange = null
        peerConnection.close()
      }
      peerConnection = null
      peerConnectionState.value = null

      if (audioElement) {
        audioElement.pause()
        audioElement.srcObject = null
      }
      audioElement = null
      remoteAudioActive.value = false
      pendingSdp = null
      startedReceived = false
      remoteDescriptionApplied = false
      previewSpeechRequested = false
      activePreviewText = null

      const accepted = startAccepted
        || (input.sendStop ? await submittedStart?.accepted : false)
        || false
      if (input.sendStop && accepted && threadId && options.client.isConnected()) {
        createPendingCloseBarrier(threadId)
        state.value = 'stopping'
        await options.client.request('thread/realtime/stop', { threadId }).catch(() => {})
      }

      owningThreadId.value = null
      sessionKind.value = null
      activeVoice.value = null
      startAccepted = false
      activity.value = 'idle'
      error.value = input.terminalState === 'error'
        ? input.message || 'The realtime voice session failed.'
        : null
      state.value = input.terminalState
    })().finally(() => {
      teardownPromise = null
    })

    return await teardownPromise
  }

  const fail = async (candidateGeneration: number, message: string, sendStop = startAccepted) => {
    const previewFailed = sessionKind.value === 'preview'
    if (previewFailed) {
      previewError.value = message
    }
    await teardown({
      candidateGeneration,
      sendStop,
      terminalState: previewFailed ? 'closed' : 'error',
      message: previewFailed ? null : message
    })
  }

  const stopForReplacement = async () => {
    if (activeGeneration === null) {
      return
    }

    const candidateGeneration = activeGeneration
    const threadId = owningThreadId.value
    await teardown({
      candidateGeneration,
      sendStop: true,
      terminalState: 'closed'
    })
    if (threadId) {
      await awaitPendingCloseBarriers()
    }
  }

  const applyRemoteSdp = async (candidateGeneration: number, sdp: string) => {
    if (!isCurrent(candidateGeneration)) {
      return
    }
    if (!peerConnection?.localDescription) {
      pendingSdp = sdp
      return
    }

    try {
      await peerConnection.setRemoteDescription({ type: 'answer', sdp })
      if (!isCurrent(candidateGeneration)) {
        return
      }
      pendingSdp = null
      remoteDescriptionApplied = true
      maybeMarkConnected(candidateGeneration)
    } catch (caughtError) {
      await fail(candidateGeneration, `Could not apply the realtime SDP answer: ${errorMessage(caughtError)}`)
    }
  }

  const handleNotification = (
    candidateGeneration: number,
    threadId: string,
    notification: CodexRpcNotification
  ) => {
    const params = notification.params as { threadId?: unknown } | undefined
    if (!isCurrent(candidateGeneration, threadId) || params?.threadId !== threadId) {
      return
    }

    switch (notification.method) {
      case 'thread/realtime/started': {
        const started = notification.params as ThreadRealtimeStartedNotification
        if (started.version !== 'v3') {
          void fail(candidateGeneration, `Unsupported realtime protocol version: ${started.version}`)
          return
        }
        startedReceived = true
        maybeMarkConnected(candidateGeneration)
        return
      }
      case 'thread/realtime/sdp': {
        if (!startedReceived) {
          return
        }
        const sdp = (notification.params as ThreadRealtimeSdpNotification).sdp
        void applyRemoteSdp(candidateGeneration, sdp)
        return
      }
      case 'thread/realtime/transcript/delta': {
        const transcript = notification.params as ThreadRealtimeTranscriptDeltaNotification
        reconcileTranscriptDelta(candidateGeneration, transcript.role, transcript.delta)
        return
      }
      case 'thread/realtime/transcript/done': {
        const transcript = notification.params as ThreadRealtimeTranscriptDoneNotification
        reconcileTranscriptDone(candidateGeneration, transcript.role, transcript.text)
        return
      }
      case 'thread/realtime/error': {
        const realtimeError = notification.params as ThreadRealtimeErrorNotification
        void fail(candidateGeneration, realtimeError.message)
        return
      }
      case 'thread/realtime/closed': {
        if (!startedReceived) {
          return
        }
        const closed = notification.params as ThreadRealtimeClosedNotification
        void teardown({
          candidateGeneration,
          sendStop: false,
          terminalState: closed.reason === 'error' ? 'error' : 'closed',
          message: closed.reason === 'error' ? 'The realtime voice session closed after an error.' : null
        })
        return
      }
      case 'turn/started':
        activity.value = 'delegating'
        return
      case 'item/started':
      case 'item/agentMessage/delta':
      case 'item/plan/delta':
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        activity.value = 'working'
        return
      case 'turn/completed':
        activity.value = 'idle'
    }
  }

  const refreshCapability = async (threadId: string, configured: boolean) => {
    const probeGeneration = ++capabilityProbeCounter
    capability.value = {
      status: 'checking',
      message: 'Checking realtime voice support.'
    }

    if (!configured || !environment.isSecureContext() || !environment.supportsRealtime()) {
      const resolved = resolveRealtimeCapability({
        configured,
        secureContext: environment.isSecureContext(),
        browserSupported: environment.supportsRealtime()
      })
      if (probeGeneration === capabilityProbeCounter) {
        capability.value = resolved
      }
      return capability.value
    }

    try {
      const response = await options.client.request<ExperimentalFeatureListResponse>(
        'experimentalFeature/list',
        { threadId, limit: 100 }
      )
      const resolved = resolveRealtimeCapability({
        configured,
        secureContext: true,
        browserSupported: true,
        response
      })
      if (probeGeneration === capabilityProbeCounter) {
        capability.value = resolved
      }
    } catch (caughtError) {
      const resolved = resolveRealtimeCapability({
        configured,
        secureContext: true,
        browserSupported: true,
        error: caughtError
      })
      if (probeGeneration === capabilityProbeCounter) {
        capability.value = resolved
      }
    }

    return capability.value
  }

  const connect = async (
    threadId: string,
    connectOptions: RealtimeConnectOptions = {}
  ) => {
    const nextSessionKind = connectOptions.kind ?? 'conversation'
    if (owningThreadId.value === threadId
      && sessionKind.value === nextSessionKind
      && activeVoice.value === (connectOptions.voice ?? null)
      && startPromise) {
      return await startPromise
    }
    if (owningThreadId.value === threadId
      && sessionKind.value === nextSessionKind
      && activeVoice.value === (connectOptions.voice ?? null)
      && state.value === 'connected') {
      return
    }
    if (capability.value.status !== 'available') {
      throw new Error(capability.value.message)
    }

    ensureConnectionMonitor()
    if (activeGeneration !== null) {
      await stopForReplacement()
    }
    await awaitPendingCloseBarriers()

    const candidateGeneration = ++generationCounter
    activeGeneration = candidateGeneration
    generation.value = candidateGeneration
    owningThreadId.value = threadId
    sessionKind.value = nextSessionKind
    activeVoice.value = connectOptions.voice ?? null
    transcripts.value = []
    error.value = null
    previewError.value = null
    autoplayBlocked.value = false
    activity.value = 'idle'
    state.value = nextSessionKind === 'preview' ? 'creating-offer' : 'requesting-permission'
    startedReceived = false
    remoteDescriptionApplied = false
    startAccepted = false
    previewSpeechRequested = false
    activePreviewText = nextSessionKind === 'preview'
      ? connectOptions.previewText?.trim() || null
      : null
    activePreviewTimeoutMs = connectOptions.previewTimeoutMs ?? DEFAULT_PREVIEW_TIMEOUT_MS

    if (nextSessionKind === 'preview' && (!connectOptions.voice || !activePreviewText)) {
      await fail(candidateGeneration, 'A supported voice and sample text are required for preview.', false)
      throw new Error('A supported voice and sample text are required for preview.')
    }

    releaseNotifications = options.client.subscribe(notification => {
      handleNotification(candidateGeneration, threadId, notification)
    })
    const currentStartPromise = (async () => {
      try {
        audioElement = environment.createAudioElement()
        audioElement.autoplay = true
        audioElement.muted = outputMuted.value

        let candidateMediaStream: RealtimeMediaStream | null = null
        if (nextSessionKind === 'conversation') {
          candidateMediaStream = await environment.getUserMedia()
          if (!isCurrent(candidateGeneration, threadId)) {
            for (const track of candidateMediaStream.getTracks()) {
              track.stop()
            }
            return
          }
          mediaStream = candidateMediaStream

          microphoneTrack = candidateMediaStream.getAudioTracks()[0] ?? null
          if (!microphoneTrack) {
            throw new Error('No microphone audio track is available.')
          }
          microphoneTrack.enabled = false
          const handleMicrophoneEnded = () => {
            if (isCurrent(candidateGeneration, threadId)) {
              void fail(candidateGeneration, 'Microphone access ended or the input device was removed.')
            }
          }
          microphoneTrack.addEventListener?.('ended', handleMicrophoneEnded)
          releaseMicrophoneEnded = () => {
            microphoneTrack?.removeEventListener?.('ended', handleMicrophoneEnded)
          }
        }

        state.value = 'creating-offer'
        const candidatePeerConnection = environment.createPeerConnection()
        peerConnection = candidatePeerConnection
        peerConnectionState.value = candidatePeerConnection.connectionState
        candidatePeerConnection.ontrack = (event) => {
          if (!isCurrent(candidateGeneration, threadId)
            || peerConnection !== candidatePeerConnection
            || !audioElement) {
            return
          }
          const stream = event.streams[0]
          if (!stream) {
            return
          }
          audioElement.srcObject = stream
          remoteAudioActive.value = true
          void audioElement.play().then(() => {
            if (isCurrent(candidateGeneration, threadId)) {
              autoplayBlocked.value = false
              if (sessionKind.value === 'preview') {
                previewError.value = null
              }
            }
          }).catch(() => {
            if (isCurrent(candidateGeneration, threadId)) {
              autoplayBlocked.value = true
              if (sessionKind.value === 'preview') {
                previewError.value = 'Browser autoplay blocked this preview. Interact with the page and retry.'
              }
            }
          })
        }
        candidatePeerConnection.onconnectionstatechange = () => {
          if (!isCurrent(candidateGeneration, threadId)
            || peerConnection !== candidatePeerConnection) {
            return
          }
          peerConnectionState.value = candidatePeerConnection.connectionState
          if (candidatePeerConnection.connectionState === 'failed'
            || candidatePeerConnection.connectionState === 'disconnected'
            || candidatePeerConnection.connectionState === 'closed') {
            void fail(
              candidateGeneration,
              `The WebRTC connection ${candidatePeerConnection.connectionState}.`
            )
            return
          }
          maybeMarkConnected(candidateGeneration)
        }

        if (nextSessionKind === 'preview') {
          candidatePeerConnection.addTransceiver('audio', { direction: 'recvonly' })
        } else if (microphoneTrack && candidateMediaStream) {
          candidatePeerConnection.addTrack(microphoneTrack, candidateMediaStream)
        }
        dataChannel = candidatePeerConnection.createDataChannel('oai-events')
        const offer = await candidatePeerConnection.createOffer()
        if (!isCurrent(candidateGeneration, threadId)
          || peerConnection !== candidatePeerConnection) {
          return
        }
        await candidatePeerConnection.setLocalDescription(offer)
        if (!isCurrent(candidateGeneration, threadId)
          || peerConnection !== candidatePeerConnection) {
          return
        }

        const sdp = candidatePeerConnection.localDescription?.sdp ?? offer.sdp
        if (!sdp) {
          throw new Error('The browser did not create an SDP offer.')
        }

        if (pendingSdp) {
          await applyRemoteSdp(candidateGeneration, pendingSdp)
        }

        state.value = 'starting'
        const params: ThreadRealtimeStartParams = {
          threadId,
          outputModality: 'audio',
          version: 'v3',
          ...(connectOptions.voice ? { voice: connectOptions.voice } : {}),
          ...(nextSessionKind === 'preview'
            ? {
                includeStartupContext: false,
                clientManagedHandoffs: true
              }
            : {}),
          transport: {
            type: 'webrtc',
            sdp
          }
        }
        const startRequest = options.client.request('thread/realtime/start', params)
        const submittedStart: PendingStartRequest = {
          generation: candidateGeneration,
          threadId,
          accepted: startRequest.then(() => true, () => false)
        }
        pendingStartRequest = submittedStart
        await startRequest
        if (!isCurrent(candidateGeneration, threadId)) {
          return
        }
        startAccepted = true
        connectionTimer = environment.setTimeout(() => {
          if (isCurrent(candidateGeneration, threadId) && state.value !== 'connected') {
            void fail(candidateGeneration, 'Timed out while connecting realtime voice.', true)
          }
        }, connectionTimeoutMs)
      } catch (caughtError) {
        if (!isCurrent(candidateGeneration, threadId)) {
          return
        }
        const message = errorMessage(caughtError)
        const normalized = /permission|notallowederror|denied/i.test(message)
          ? `Microphone permission was denied: ${message}`
          : message
        await fail(candidateGeneration, normalized, startAccepted)
        throw caughtError
      } finally {
        if (pendingStartRequest?.generation === candidateGeneration) {
          pendingStartRequest = null
        }
      }
    })().finally(() => {
      if (startPromise === currentStartPromise) {
        startPromise = null
      }
    })
    startPromise = currentStartPromise

    return await currentStartPromise
  }

  const setMicrophoneEnabled = (enabled: boolean) => {
    const track = microphoneTrack
    if (!track || state.value !== 'connected') {
      if (enabled) {
        throw new Error('Realtime voice is not connected yet.')
      }
      microphoneEnabled.value = false
      return
    }

    track.enabled = enabled
    microphoneEnabled.value = enabled
    activity.value = enabled ? 'listening' : activity.value === 'listening' ? 'idle' : activity.value
  }

  const setOutputMuted = async (muted: boolean) => {
    outputMuted.value = muted
    if (!audioElement) {
      return
    }
    audioElement.muted = muted
    if (!muted && audioElement.srcObject) {
      try {
        await audioElement.play()
        autoplayBlocked.value = false
      } catch {
        autoplayBlocked.value = true
      }
    }
  }

  const stop = async () => {
    if (activeGeneration === null) {
      return
    }
    await teardown({
      candidateGeneration: activeGeneration,
      sendStop: true,
      terminalState: 'closed'
    })
  }

  const stopForThreadChange = async (nextThreadId: string | null) => {
    if (owningThreadId.value && owningThreadId.value !== nextThreadId) {
      await stop()
    }
  }

  const dispose = async () => {
    await stop()
    releasePersistentConnection?.()
    releasePersistentConnection = null
    clearPendingCloseBarriers()
  }

  return {
    capability,
    state,
    activity,
    sessionKind,
    activeVoice,
    owningThreadId,
    generation,
    transcripts,
    latestUserTranscript,
    error,
    outputMuted,
    autoplayBlocked,
    microphoneEnabled,
    remoteAudioActive,
    peerConnectionState,
    voiceCatalog,
    previewStatus,
    previewError,
    refreshCapability,
    refreshVoiceCatalog,
    invalidateVoiceCatalog,
    connect,
    setMicrophoneEnabled,
    setOutputMuted,
    stop,
    stopForReplacement,
    stopForThreadChange,
    dispose
  }
}

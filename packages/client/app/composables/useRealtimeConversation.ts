import { computed, ref } from 'vue'
import type { CodexRpcClient, CodexRpcNotification } from '~~/shared/codex-rpc'
import type { ExperimentalFeatureListResponse } from '~~/shared/generated/codex-app-server/v2/ExperimentalFeatureListResponse'
import type { ThreadRealtimeClosedNotification } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeClosedNotification'
import type { ThreadRealtimeErrorNotification } from '~~/shared/generated/codex-app-server/v2/ThreadRealtimeErrorNotification'
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

const DEFAULT_CONNECTION_TIMEOUT_MS = 20_000

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
  const owningThreadId = ref<string | null>(null)
  const generation = ref(0)
  const transcripts = ref<RealtimeTranscriptSegment[]>([])
  const error = ref<string | null>(null)
  const outputMuted = ref(false)
  const autoplayBlocked = ref(false)
  const microphoneEnabled = ref(false)
  const remoteAudioActive = ref(false)
  const peerConnectionState = ref<RTCPeerConnectionState | null>(null)
  const latestUserTranscript = computed(() =>
    transcripts.value.findLast(segment => segment.role === 'user' && segment.final)?.text ?? null
  )

  let generationCounter = 0
  let capabilityProbeCounter = 0
  let transcriptCounter = 0
  let activeGeneration: number | null = null
  let mediaStream: RealtimeMediaStream | null = null
  let microphoneTrack: RealtimeTrack | null = null
  let peerConnection: RealtimePeerConnection | null = null
  let dataChannel: RealtimeDataChannel | null = null
  let audioElement: RealtimeAudioElement | null = null
  let releaseNotifications: (() => void) | null = null
  let releaseConnection: (() => void) | null = null
  let releaseMicrophoneEnded: (() => void) | null = null
  let connectionTimer: ReturnType<typeof globalThis.setTimeout> | null = null
  let startPromise: Promise<void> | null = null
  let teardownPromise: Promise<void> | null = null
  let startedReceived = false
  let remoteDescriptionApplied = false
  let pendingSdp: string | null = null
  let startAccepted = false

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
      activeGeneration = null
      clearConnectionTimer()
      releaseNotifications?.()
      releaseNotifications = null
      releaseConnection?.()
      releaseConnection = null
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

      if (input.sendStop && startAccepted && threadId && options.client.isConnected()) {
        state.value = 'stopping'
        await options.client.request('thread/realtime/stop', { threadId }).catch(() => {})
      }

      owningThreadId.value = null
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
    await teardown({
      candidateGeneration,
      sendStop,
      terminalState: 'error',
      message
    })
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

  const connect = async (threadId: string) => {
    if (owningThreadId.value === threadId && startPromise) {
      return await startPromise
    }
    if (owningThreadId.value === threadId && state.value === 'connected') {
      return
    }
    if (capability.value.status !== 'available') {
      throw new Error(capability.value.message)
    }

    if (activeGeneration !== null) {
      await teardown({
        candidateGeneration: activeGeneration,
        sendStop: true,
        terminalState: 'closed'
      })
    }

    const candidateGeneration = ++generationCounter
    activeGeneration = candidateGeneration
    generation.value = candidateGeneration
    owningThreadId.value = threadId
    transcripts.value = []
    error.value = null
    autoplayBlocked.value = false
    activity.value = 'idle'
    state.value = 'requesting-permission'
    startedReceived = false
    remoteDescriptionApplied = false
    startAccepted = false

    releaseNotifications = options.client.subscribe(notification => {
      handleNotification(candidateGeneration, threadId, notification)
    })
    releaseConnection = options.client.subscribeConnectionState((connectionState) => {
      if (connectionState === 'disconnected' && isCurrent(candidateGeneration, threadId)) {
        void fail(candidateGeneration, 'The Codex RPC connection closed.', false)
      }
    })

    const currentStartPromise = (async () => {
      try {
        audioElement = environment.createAudioElement()
        audioElement.autoplay = true
        audioElement.muted = outputMuted.value

        mediaStream = await environment.getUserMedia()
        if (!isCurrent(candidateGeneration, threadId)) {
          for (const track of mediaStream.getTracks()) {
            track.stop()
          }
          return
        }

        microphoneTrack = mediaStream.getAudioTracks()[0] ?? null
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

        state.value = 'creating-offer'
        peerConnection = environment.createPeerConnection()
        peerConnectionState.value = peerConnection.connectionState
        peerConnection.ontrack = (event) => {
          if (!isCurrent(candidateGeneration, threadId) || !audioElement) {
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
            }
          }).catch(() => {
            if (isCurrent(candidateGeneration, threadId)) {
              autoplayBlocked.value = true
            }
          })
        }
        peerConnection.onconnectionstatechange = () => {
          if (!isCurrent(candidateGeneration, threadId) || !peerConnection) {
            return
          }
          peerConnectionState.value = peerConnection.connectionState
          if (peerConnection.connectionState === 'failed'
            || peerConnection.connectionState === 'disconnected'
            || peerConnection.connectionState === 'closed') {
            void fail(
              candidateGeneration,
              `The WebRTC connection ${peerConnection.connectionState}.`
            )
            return
          }
          maybeMarkConnected(candidateGeneration)
        }

        peerConnection.addTrack(microphoneTrack, mediaStream)
        dataChannel = peerConnection.createDataChannel('oai-events')
        const offer = await peerConnection.createOffer()
        await peerConnection.setLocalDescription(offer)
        if (!isCurrent(candidateGeneration, threadId)) {
          return
        }

        const sdp = peerConnection.localDescription?.sdp ?? offer.sdp
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
          transport: {
            type: 'webrtc',
            sdp
          }
        }
        await options.client.request('thread/realtime/start', params)
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
  }

  return {
    capability,
    state,
    activity,
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
    refreshCapability,
    connect,
    setMicrophoneEnabled,
    setOutputMuted,
    stop,
    stopForThreadChange,
    dispose
  }
}

import type { ServerCapabilitiesResponse } from '@codori/client/shared/codori'
import type { CodexRpcClient } from '@codori/client/shared/codex-rpc'
import {
  createRealtimeConversationController,
  type RealtimeConversationSnapshot
} from '@codori/client/shared/realtime'
import type { RealtimeVisualActivity } from './light-model'

export type VoiceRuntimeOptions = {
  client: CodexRpcClient
  threadId: string
  capabilitiesUrl?: string
  fetch?: typeof globalThis.fetch
}

const voiceSessionActive = (snapshot: RealtimeConversationSnapshot) =>
  snapshot.state === 'requesting-permission'
  || snapshot.state === 'creating-offer'
  || snapshot.state === 'starting'
  || snapshot.state === 'connected'
  || snapshot.state === 'stopping'

export const resolveImmersiveVoiceActivity = (
  snapshot: RealtimeConversationSnapshot
): RealtimeVisualActivity => {
  if (snapshot.activity !== 'speaking') {
    return snapshot.activity
  }
  const latestAssistant = [...snapshot.transcripts].reverse().find(segment =>
    segment.generation === snapshot.generation
    && segment.role === 'assistant'
  )
  if (!latestAssistant?.final) {
    return 'speaking'
  }
  return snapshot.microphoneEnabled ? 'listening' : 'idle'
}

export class VoiceRuntime {
  private readonly controller

  private readonly fetch: typeof globalThis.fetch

  private readonly listeners = new Set<
    (snapshot: RealtimeConversationSnapshot) => void
  >()

  private snapshot: RealtimeConversationSnapshot

  private pendingMicrophone = false

  private releaseController: (() => void) | null = null

  constructor(private readonly options: VoiceRuntimeOptions) {
    this.controller = createRealtimeConversationController({
      client: options.client
    })
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.snapshot = this.controller.getSnapshot()
    this.releaseController = this.controller.subscribe((snapshot) => {
      this.snapshot = snapshot
      if (
        this.pendingMicrophone
        && snapshot.state === 'connected'
        && snapshot.sessionKind === 'conversation'
      ) {
        this.pendingMicrophone = false
        this.controller.setMicrophoneEnabled(true)
      }
      if (
        snapshot.state === 'closed'
        || snapshot.state === 'error'
      ) {
        this.pendingMicrophone = false
      }
      for (const listener of this.listeners) {
        listener(this.snapshot)
      }
    })
  }

  subscribe(listener: (snapshot: RealtimeConversationSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot() {
    return this.snapshot
  }

  async toggle() {
    if (this.snapshot.autoplayBlocked) {
      await this.controller.setOutputMuted(false)
      return
    }
    if (voiceSessionActive(this.snapshot)) {
      this.pendingMicrophone = false
      await this.controller.stop()
      return
    }

    try {
      const response = await this.fetch(
        this.options.capabilitiesUrl ?? '/api/capabilities',
        {
          credentials: 'same-origin',
          headers: {
            accept: 'application/json'
          }
        }
      )
      if (!response.ok) {
        throw new Error(`Capability request failed with HTTP ${response.status}.`)
      }
      const body = await response.json() as ServerCapabilitiesResponse
      const capability = await this.controller.refreshCapability(
        this.options.threadId,
        body.capabilities.realtimeVoice.configured
      )
      if (capability.status !== 'available') {
        this.pendingMicrophone = false
        return
      }
      this.pendingMicrophone = true
      await this.controller.connect(this.options.threadId)
    } catch (error) {
      this.pendingMicrophone = false
      this.controller.setCapability({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  async stop() {
    this.pendingMicrophone = false
    await this.controller.stop()
  }

  async dispose() {
    this.listeners.clear()
    this.releaseController?.()
    this.releaseController = null
    await this.controller.dispose()
  }
}

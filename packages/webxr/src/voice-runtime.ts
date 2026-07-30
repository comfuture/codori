import type { ServerCapabilitiesResponse } from '@codori/client/shared/codori'
import type { CodexRpcClient } from '@codori/client/shared/codex-rpc'
import type {
  ConfigReadParams,
  ConfigReadResponse
} from '@codori/client/shared/generated/codex-app-server/v2'
import {
  createRealtimeConversationController,
  type RealtimeConversationSnapshot
} from '@codori/client/shared/realtime'
import {
  readRealtimeVoiceSettings,
  resolveConfiguredRealtimeVoicePrompt,
  resolveRealtimeVoiceOverride,
  resolveRealtimeVoiceStartPrompt,
  type RealtimeVoiceSettingsStorage
} from '@codori/client/shared/realtime-voice-settings'
import type { RealtimeVisualActivity } from './light-model'

export type VoiceRuntimeOptions = {
  client: CodexRpcClient
  threadId: string
  cwd?: string | null
  storage?: RealtimeVoiceSettingsStorage | null
  capabilitiesUrl?: string
  fetch?: typeof globalThis.fetch
  configReadTimeoutMs?: number
}

const DEFAULT_CONFIG_READ_TIMEOUT_MS = 5_000

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

const resolveBrowserStorage = (): RealtimeVoiceSettingsStorage | null => {
  if (typeof window === 'undefined') {
    return null
  }
  try {
    return window.localStorage
  } catch {
    return null
  }
}

const withTimeout = async <Result>(
  operation: Promise<Result>,
  timeoutMs: number
): Promise<Result> => {
  let timeoutId: ReturnType<typeof globalThis.setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeoutId = globalThis.setTimeout(() => {
          reject(new Error('Timed out reading realtime voice configuration.'))
        }, timeoutMs)
      })
    ])
  } finally {
    if (timeoutId !== undefined) {
      globalThis.clearTimeout(timeoutId)
    }
  }
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

  private async resolveStartPrompt(localOverride: string | null) {
    if (localOverride !== null) {
      return localOverride
    }
    try {
      const response = await withTimeout(
        this.options.client.request<ConfigReadResponse>(
          'config/read',
          {
            includeLayers: false,
            cwd: this.options.cwd ?? null
          } satisfies ConfigReadParams
        ),
        this.options.configReadTimeoutMs ?? DEFAULT_CONFIG_READ_TIMEOUT_MS
      )
      return resolveRealtimeVoiceStartPrompt({
        configuredPrompt: resolveConfiguredRealtimeVoicePrompt(response.config),
        localOverride: null
      })
    } catch {
      return undefined
    }
  }

  async start() {
    if (this.snapshot.autoplayBlocked) {
      await this.controller.setOutputMuted(false)
      return
    }
    if (voiceSessionActive(this.snapshot)) {
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
      const settings = readRealtimeVoiceSettings(
        this.options.storage === undefined
          ? resolveBrowserStorage()
          : this.options.storage
      )
      const catalog = await this.controller.refreshVoiceCatalog(true)
      const voice = resolveRealtimeVoiceOverride({
        advertisedVoices: catalog.voices,
        savedVoice: settings.savedVoice
      })
      const prompt = await this.resolveStartPrompt(
        settings.localPromptOverride
      )
      this.pendingMicrophone = true
      await this.controller.connect(this.options.threadId, {
        ...(voice !== undefined ? { voice } : {}),
        ...(prompt !== undefined ? { prompt } : {})
      })
    } catch (error) {
      this.pendingMicrophone = false
      this.controller.setCapability({
        status: 'failed',
        message: error instanceof Error ? error.message : String(error)
      })
      throw error
    }
  }

  async toggle() {
    if (
      !this.snapshot.autoplayBlocked
      && voiceSessionActive(this.snapshot)
    ) {
      this.pendingMicrophone = false
      await this.controller.stop()
      return
    }
    await this.start()
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

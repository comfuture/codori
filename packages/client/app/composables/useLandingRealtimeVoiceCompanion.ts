import { useRuntimeConfig } from '#imports'
import { $fetch } from 'ofetch'
import { computed, ref, watch, type Ref } from 'vue'
import { useChats } from './useChats'
import { useRpc } from './useRpc'
import {
  promoteSharedRealtimeConversation,
  useActiveRealtimeConversation,
  useSharedRealtimeConversation
} from './useSharedRealtimeConversation'
import {
  useRealtimeVoicePreference,
  useRealtimeVoicePromptPreference
} from './useRealtimeVoicePreference'
import {
  matchesLandingRealtimeVoicePresentation,
  useLandingRealtimeVoicePresentation,
  type LandingRealtimeVoicePresentation
} from './useLandingRealtimeVoicePresentation'
import { withPromptControlsTimeout } from '../utils/prompt-controls-readiness'
import { isRealtimeVoiceCompanionActive } from '../utils/realtime-voice-companion'
import type { CodexRpcClient } from '~~/shared/codex-rpc'
import type { ConfigReadParams } from '~~/shared/generated/codex-app-server/v2/ConfigReadParams'
import type { ConfigReadResponse } from '~~/shared/generated/codex-app-server/v2/ConfigReadResponse'
import type { ThreadSettingsUpdateParams } from '~~/shared/generated/codex-app-server/v2/ThreadSettingsUpdateParams'
import type { ThreadSettingsUpdateResponse } from '~~/shared/generated/codex-app-server/v2/ThreadSettingsUpdateResponse'
import type { ThreadStartParams } from '~~/shared/generated/codex-app-server/v2/ThreadStartParams'
import type { ThreadStartResponse } from '~~/shared/generated/codex-app-server/v2/ThreadStartResponse'
import type {
  RealtimeSessionKind,
  RealtimeSessionState,
  RealtimeVoiceCatalog
} from '~~/shared/realtime-core'
import {
  resolveConfiguredRealtimeVoicePrompt,
  resolveRealtimeVoiceOverride,
  resolveRealtimeVoiceStartPrompt
} from '~~/shared/realtime-voice-settings'
import type {
  ChatSessionRecord,
  ServerCapabilitiesResponse
} from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'

export const LANDING_VOICE_MODEL = 'gpt-5.6-luna'
export const LANDING_VOICE_REASONING_EFFORT = 'xhigh'
export const LANDING_VOICE_DEVELOPER_INSTRUCTIONS = [
  "This thread was opened as Codori's current voice companion.",
  'Treat pwd and the current working directory as incidental context, not as a meaningful scope boundary.',
  'Proactively find and help with useful work in Codori project threads or on the computer hosting Codori.',
  'Use the available tools and context to make concrete progress while following normal authorization, approval, and safety boundaries.'
].join(' ')

type LandingRealtimeVoiceController = {
  refreshCapability: (
    threadId: string,
    configured: boolean
  ) => Promise<{ status: string, message: string }>
  refreshVoiceCatalog: (force?: boolean) => Promise<unknown>
  connect: (
    threadId: string,
    options?: { voice?: RealtimeVoiceCatalog['voices'][number], prompt?: string }
  ) => Promise<void>
  stop: () => Promise<void>
}

export const useDeferredRealtimeVoiceMicrophoneActivation = (input: {
  state: Readonly<Ref<RealtimeSessionState>>
  sessionKind: Readonly<Ref<RealtimeSessionKind | null>>
  setMicrophoneEnabled: (enabled: boolean) => void
}) => {
  const pending = ref(false)

  const activateWhenConnected = () => {
    if (
      pending.value
      && input.state.value === 'connected'
      && input.sessionKind.value === 'conversation'
    ) {
      pending.value = false
      input.setMicrophoneEnabled(true)
      return
    }

    if (
      input.state.value === 'idle'
      || input.state.value === 'stopping'
      || input.state.value === 'closed'
      || input.state.value === 'error'
    ) {
      pending.value = false
    }
  }

  watch([input.state, input.sessionKind], activateWhenConnected)

  return {
    pending,
    request: () => {
      pending.value = true
      activateWhenConnected()
    }
  }
}

export type LandingRealtimeVoiceCompanionDependencies = {
  activeChatId: Ref<string | null>
  voiceCatalog: Readonly<Ref<RealtimeVoiceCatalog>>
  savedVoice: Readonly<Ref<string | null>>
  savedPrompt: Readonly<Ref<string | null>>
  hasActiveSession: () => boolean
  ownsActiveSession: () => boolean
  fetchCapabilities: () => Promise<ServerCapabilitiesResponse>
  createChat: () => Promise<ChatSessionRecord>
  setChatThread: (chatId: string, threadId: string) => Promise<unknown>
  getChatClient: (chatId: string) => CodexRpcClient
  promoteConversation: (sourceKey: string, targetKey: string) => void
  realtimeVoice: LandingRealtimeVoiceController
  requestMicrophoneActivation: () => void
  showPresentation: (presentation: LandingRealtimeVoicePresentation) => void
  clearPresentation: (presentation?: LandingRealtimeVoicePresentation) => void
}

export const createLandingRealtimeVoiceCompanion = (
  dependencies: LandingRealtimeVoiceCompanionDependencies,
  initialWorkspaceKey = 'chat:landing-voice-draft'
) => {
  const pending = ref(false)
  const error = ref<string | null>(null)
  let workspaceKey = initialWorkspaceKey

  const start = async () => {
    if (pending.value) {
      return
    }
    if (dependencies.hasActiveSession()) {
      error.value = 'A voice session is already active in another thread.'
      return
    }

    pending.value = true
    error.value = null
    let presentation: LandingRealtimeVoicePresentation | undefined

    try {
      const capabilities = await dependencies.fetchCapabilities()
      if (!capabilities.capabilities.realtimeVoice.configured) {
        throw new Error('Experimental realtime voice is disabled in Codori.')
      }

      const chat = await dependencies.createChat()
      dependencies.activeChatId.value = chat.chatId
      const client = dependencies.getChatClient(chat.chatId)
      const startResponse = await client.request<ThreadStartResponse>('thread/start', {
        model: LANDING_VOICE_MODEL,
        cwd: null,
        approvalPolicy: 'never',
        developerInstructions: LANDING_VOICE_DEVELOPER_INSTRUCTIONS,
        experimentalRawEvents: false
      } satisfies ThreadStartParams)
      const threadId = startResponse.thread.id

      await client.request<ThreadSettingsUpdateResponse>('thread/settings/update', {
        threadId,
        model: LANDING_VOICE_MODEL,
        effort: LANDING_VOICE_REASONING_EFFORT
      } satisfies ThreadSettingsUpdateParams)
      await dependencies.setChatThread(chat.chatId, threadId)

      const nextWorkspaceKey = `chat:${chat.chatId}`
      dependencies.promoteConversation(workspaceKey, nextWorkspaceKey)
      workspaceKey = nextWorkspaceKey

      const capability = await dependencies.realtimeVoice.refreshCapability(
        threadId,
        true
      )
      if (capability.status !== 'available') {
        throw new Error(capability.message)
      }
      await dependencies.realtimeVoice.refreshVoiceCatalog(true)

      let startPrompt: string | undefined
      try {
        const configResponse = await withPromptControlsTimeout(
          client.request<ConfigReadResponse>('config/read', {
            includeLayers: false,
            cwd: null
          } satisfies ConfigReadParams),
          'voice prompt configuration',
          5_000
        )
        startPrompt = resolveRealtimeVoiceStartPrompt({
          configuredPrompt: resolveConfiguredRealtimeVoicePrompt(configResponse.config),
          localOverride: dependencies.savedPrompt.value
        })
      } catch {
        startPrompt = dependencies.savedPrompt.value ?? undefined
      }

      presentation = {
        workspaceKey,
        threadId
      }
      dependencies.showPresentation(presentation)

      await dependencies.realtimeVoice.connect(threadId, {
        voice: resolveRealtimeVoiceOverride({
          advertisedVoices: dependencies.voiceCatalog.value.voices,
          savedVoice: dependencies.savedVoice.value
        }),
        ...(startPrompt !== undefined ? { prompt: startPrompt } : {})
      })
      dependencies.requestMicrophoneActivation()
    } catch (caughtError) {
      dependencies.clearPresentation(presentation)
      if (dependencies.ownsActiveSession()) {
        await dependencies.realtimeVoice.stop().catch(() => {})
      }
      error.value = caughtError instanceof Error
        ? caughtError.message
        : String(caughtError)
    } finally {
      pending.value = false
    }
  }

  return {
    pending,
    error,
    start
  }
}

export const useLandingRealtimeVoiceCompanion = () => {
  const runtimeConfig = useRuntimeConfig()
  const activeChatId = ref<string | null>(null)
  const draftWorkspaceKey = 'chat:landing-voice-draft'
  const { createChat, setChatThread } = useChats()
  const { getChatClient } = useRpc()
  const activeRealtimeVoice = useActiveRealtimeConversation()
  const presentation = useLandingRealtimeVoicePresentation()
  const realtimeVoice = useSharedRealtimeConversation(
    draftWorkspaceKey,
    () => {
      if (!activeChatId.value) {
        throw new Error('The projectless voice chat has not started yet.')
      }
      return getChatClient(activeChatId.value)
    }
  )
  const voicePreference = useRealtimeVoicePreference()
  const promptPreference = useRealtimeVoicePromptPreference()
  const microphoneActivation = useDeferredRealtimeVoiceMicrophoneActivation({
    state: realtimeVoice.state,
    sessionKind: realtimeVoice.sessionKind,
    setMicrophoneEnabled: realtimeVoice.setMicrophoneEnabled
  })
  const configuredBase = String(runtimeConfig.public.serverBase ?? '')
  const capabilitiesUrl = shouldUseServerProxy(configuredBase)
    ? '/api/codori/capabilities'
    : resolveApiUrl('/capabilities', configuredBase)

  const companion = createLandingRealtimeVoiceCompanion({
    activeChatId,
    voiceCatalog: realtimeVoice.voiceCatalog,
    savedVoice: voicePreference.savedVoice,
    savedPrompt: promptPreference.savedPrompt,
    hasActiveSession: () => Boolean(activeRealtimeVoice.activeThreadId.value),
    ownsActiveSession: () => realtimeVoice.ownsActiveSession.value,
    fetchCapabilities: async () => await $fetch<ServerCapabilitiesResponse>(capabilitiesUrl),
    createChat,
    setChatThread,
    getChatClient,
    promoteConversation: promoteSharedRealtimeConversation,
    realtimeVoice,
    requestMicrophoneActivation: microphoneActivation.request,
    showPresentation: presentation.show,
    clearPresentation: presentation.clear
  }, draftWorkspaceKey)

  const centeredPresentation = computed(() =>
    isRealtimeVoiceCompanionActive(activeRealtimeVoice.state.value)
    && activeRealtimeVoice.sessionKind.value !== 'preview'
    && matchesLandingRealtimeVoicePresentation(
      presentation.presentation.value,
      activeRealtimeVoice.activeWorkspaceKey.value,
      activeRealtimeVoice.activeThreadId.value
    )
  )

  return {
    ...companion,
    centeredPresentation,
    activeSession: computed(() => Boolean(activeRealtimeVoice.activeThreadId.value))
  }
}

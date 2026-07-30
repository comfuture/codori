<script setup lang="ts">
import { useRuntimeConfig } from '#imports'
import { $fetch } from 'ofetch'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'
import type { ConfigReadParams } from '~~/shared/generated/codex-app-server/v2/ConfigReadParams'
import type { ConfigReadResponse } from '~~/shared/generated/codex-app-server/v2/ConfigReadResponse'
import type { ServerCapabilitiesResponse } from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'
import { selectRealtimeVoicePreviewSource } from '~~/shared/realtime-voice-preview'
import {
  resolveConfiguredRealtimeVoicePrompt,
  resolveRealtimeVoiceOverride
} from '~~/shared/realtime-voice-settings'
import {
  useRealtimeVoicePreference,
  useRealtimeVoicePromptPreference
} from '../composables/useRealtimeVoicePreference'
import type {
  RealtimeCapability,
  RealtimeSessionState,
  RealtimeVoiceCatalog
} from '../composables/useRealtimeConversation'
import { useRpc } from '../composables/useRpc'
import { useSharedRealtimeConversation } from '../composables/useSharedRealtimeConversation'
import { useRealtimeVoiceWorkspaceContext } from '../composables/useRealtimeVoiceWorkspaceContext'

const emptyCapability = ref<RealtimeCapability>({
  status: 'checking',
  message: 'Open an existing thread to discover realtime voices.'
})
const emptyCatalog = ref<RealtimeVoiceCatalog>({
  status: 'idle',
  voices: [],
  protocolDefault: null,
  error: null
})
const context = useRealtimeVoiceWorkspaceContext().value
const preference = useRealtimeVoicePreference()
const promptPreference = useRealtimeVoicePromptPreference()
const { getWorkspaceClient } = useRpc()
const configuredBase = String(useRuntimeConfig().public.serverBase ?? '')
const realtimeVoice = context
  ? useSharedRealtimeConversation(
      context.workspaceKey,
      () => getWorkspaceClient(context.workspace)
    )
  : null
const capability = computed(() =>
  realtimeVoice?.capability.value ?? emptyCapability.value
)
const catalog = computed(() =>
  realtimeVoice?.voiceCatalog.value ?? emptyCatalog.value
)
const selectedVoice = computed(() =>
  resolveRealtimeVoiceOverride({
    advertisedVoices: catalog.value.voices,
    savedVoice: preference.savedVoice.value
  })
)
const activeElsewhere = computed(() =>
  Boolean(
    realtimeVoice?.activeWorkspaceKey.value
    && !realtimeVoice.ownsActiveSession.value
  )
)
const previewVoice = ref<RealtimeVoice | null>(null)
const previewStatus = ref<'idle' | 'loading' | 'playing' | 'error'>('idle')
const previewError = ref<string | null>(null)
const displayedSessionKind = computed(() =>
  previewStatus.value === 'loading' || previewStatus.value === 'playing'
    ? 'preview' as const
    : realtimeVoice?.sessionKind.value ?? null
)
const displayedSessionState = computed<RealtimeSessionState>(() => {
  if (previewStatus.value === 'loading') {
    return 'starting'
  }
  if (previewStatus.value === 'playing') {
    return 'connected'
  }
  return realtimeVoice?.state.value ?? 'idle'
})
const displayedActiveVoice = computed(() =>
  previewVoice.value ?? realtimeVoice?.activeVoice.value ?? null
)
const configuredPrompt = ref<string | null>(null)
const promptConfigLoading = ref(false)
const promptConfigError = ref<string | null>(null)

let refreshRequest = 0
let previewGeneration = 0
let previewAudio: HTMLAudioElement | null = null

const capabilitiesUrl = () => {
  return shouldUseServerProxy(configuredBase)
    ? '/api/codori/capabilities'
    : resolveApiUrl('/capabilities', configuredBase)
}

const refreshPromptConfig = async () => {
  if (!context) {
    promptConfigError.value = 'Open an existing thread before Settings to read config.toml.'
    return
  }

  promptConfigLoading.value = true
  promptConfigError.value = null
  try {
    const response = await getWorkspaceClient(context.workspace).request<ConfigReadResponse>(
      'config/read',
      {
        includeLayers: false,
        cwd: context.cwd
      } satisfies ConfigReadParams
    )
    configuredPrompt.value = resolveConfiguredRealtimeVoicePrompt(response.config)
  } catch (error) {
    promptConfigError.value = `Could not read config.toml: ${
      error instanceof Error ? error.message : String(error)
    }`
  } finally {
    promptConfigLoading.value = false
  }
}

const refresh = async () => {
  if (!context || !realtimeVoice) {
    return
  }

  const request = ++refreshRequest
  realtimeVoice.capability.value = {
    status: 'checking',
    message: 'Checking realtime voice support.'
  }

  try {
    const response = await $fetch<ServerCapabilitiesResponse>(capabilitiesUrl())
    if (request !== refreshRequest) {
      return
    }
    const nextCapability = await realtimeVoice.refreshCapability(
      context.threadId,
      response.capabilities.realtimeVoice.configured
    )
    if (request === refreshRequest && nextCapability.status === 'available') {
      await realtimeVoice.refreshVoiceCatalog(true)
    }
  } catch (error) {
    if (request !== refreshRequest) {
      return
    }
    realtimeVoice.capability.value = {
      status: 'failed',
      message: `Could not load Codori voice capability: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

const releasePreviewAudio = () => {
  if (!previewAudio) {
    return
  }
  previewAudio.pause()
  previewAudio.removeAttribute('src')
  previewAudio.load()
  previewAudio = null
}

const stopLocalPreview = () => {
  previewGeneration += 1
  releasePreviewAudio()
  previewVoice.value = null
  previewStatus.value = 'idle'
  previewError.value = null
}

const preview = async (voice: RealtimeVoice) => {
  if (
    activeElsewhere.value
    || (realtimeVoice?.sessionKind.value === 'conversation'
      && realtimeVoice.state.value === 'connected')
  ) {
    return
  }

  stopLocalPreview()
  const generation = previewGeneration
  const audio = new Audio()
  const source = selectRealtimeVoicePreviewSource(
    voice,
    type => audio.canPlayType(type)
  )
  if (!source) {
    previewError.value = `No supported preview format is available for ${voice}.`
    previewStatus.value = 'error'
    return
  }

  previewAudio = audio
  previewVoice.value = voice
  previewStatus.value = 'loading'
  audio.preload = 'none'
  audio.src = source.src
  audio.addEventListener('playing', () => {
    if (generation === previewGeneration && previewAudio === audio) {
      previewStatus.value = 'playing'
    }
  })
  audio.addEventListener('ended', () => {
    if (generation === previewGeneration && previewAudio === audio) {
      previewAudio = null
      previewVoice.value = null
      previewStatus.value = 'idle'
    }
  })
  audio.addEventListener('error', () => {
    if (generation === previewGeneration && previewAudio === audio) {
      previewAudio = null
      previewVoice.value = null
      previewStatus.value = 'error'
      previewError.value = `Could not play the ${voice} preview.`
    }
  })

  try {
    await audio.play()
  } catch (error) {
    if (generation === previewGeneration && previewAudio === audio) {
      releasePreviewAudio()
      previewVoice.value = null
      previewStatus.value = 'error'
      previewError.value = `Could not play the ${voice} preview: ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}

const stopPreview = () => {
  stopLocalPreview()
  if (
    realtimeVoice?.sessionKind.value === 'preview'
    && realtimeVoice.ownsActiveSession.value
  ) {
    void realtimeVoice.stop()
  }
}

onMounted(() => {
  void refresh()
  void refreshPromptConfig()
})

onBeforeUnmount(() => {
  refreshRequest += 1
  stopPreview()
})
</script>

<template>
  <RealtimeVoiceSettings
    :capability="capability"
    :catalog="catalog"
    :selected-voice="selectedVoice"
    :saved-voice="preference.savedVoice.value"
    :session-kind="displayedSessionKind"
    :session-state="displayedSessionState"
    :active-voice="displayedActiveVoice"
    :preview-status="previewStatus"
    :preview-error="previewError"
    :active-elsewhere="activeElsewhere"
    :has-workspace-context="Boolean(context)"
    @select="preference.selectVoice"
    @refresh="void refresh()"
    @preview="void preview($event)"
    @stop-preview="stopPreview"
  />
  <RealtimeVoicePromptSettings
    :configured-prompt="configuredPrompt"
    :prompt-override="promptPreference.savedPrompt.value"
    :loading="promptConfigLoading"
    :error="promptConfigError"
    @save="promptPreference.setPrompt"
    @clear="promptPreference.setPrompt(null)"
    @refresh="void refreshPromptConfig()"
  />
</template>

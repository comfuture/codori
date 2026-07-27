<script setup lang="ts">
import { useRuntimeConfig } from '#imports'
import { $fetch } from 'ofetch'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'
import type { ServerCapabilitiesResponse } from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'
import {
  resolveRealtimeVoiceOverride,
  resolveRealtimeVoicePreviewText,
  useRealtimeVoicePreference
} from '../composables/useRealtimeVoicePreference'
import type {
  RealtimeCapability,
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

let refreshRequest = 0

const capabilitiesUrl = () => {
  return shouldUseServerProxy(configuredBase)
    ? '/api/codori/capabilities'
    : resolveApiUrl('/capabilities', configuredBase)
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

const preview = async (voice: RealtimeVoice) => {
  if (
    !context
    || !realtimeVoice
    || realtimeVoice.sessionKind.value === 'conversation'
    || activeElsewhere.value
  ) {
    return
  }

  try {
    if (realtimeVoice.capability.value.status !== 'available') {
      await refresh()
    }
    if (
      realtimeVoice.capability.value.status !== 'available'
      || !realtimeVoice.voiceCatalog.value.voices.includes(voice)
    ) {
      return
    }
    await realtimeVoice.preview(
      context.threadId,
      voice,
      resolveRealtimeVoicePreviewText(window.navigator.language)
    )
  } catch {
    // The shared controller exposes a bounded preview error for the page.
  }
}

const stopPreview = () => {
  if (
    realtimeVoice?.sessionKind.value === 'preview'
    && realtimeVoice.ownsActiveSession.value
  ) {
    void realtimeVoice.stop()
  }
}

onMounted(() => {
  void refresh()
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
    :session-kind="realtimeVoice?.sessionKind.value ?? null"
    :session-state="realtimeVoice?.state.value ?? 'idle'"
    :active-voice="realtimeVoice?.activeVoice.value ?? null"
    :preview-status="realtimeVoice?.previewStatus.value ?? 'idle'"
    :preview-error="realtimeVoice?.previewError.value ?? null"
    :active-elsewhere="activeElsewhere"
    :has-workspace-context="Boolean(context)"
    @select="preference.selectVoice"
    @refresh="void refresh()"
    @preview="void preview($event)"
    @stop-preview="stopPreview"
  />
</template>

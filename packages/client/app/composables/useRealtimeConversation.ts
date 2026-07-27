import { computed, shallowRef } from 'vue'
import {
  createRealtimeConversationController,
  type RealtimeBrowserEnvironment,
  type RealtimeCapability,
  type RealtimeConnectOptions,
  type RealtimeConversationSnapshot
} from '~~/shared/realtime'
import type { CodexRpcClient } from '~~/shared/codex-rpc'

export * from '../../shared/realtime'

type RealtimeRpcClient = Pick<
  CodexRpcClient,
  'request' | 'subscribe' | 'subscribeConnectionState' | 'isConnected'
>

type ControllerOptions = {
  client: RealtimeRpcClient
  environment?: RealtimeBrowserEnvironment
  connectionTimeoutMs?: number
}

export const useRealtimeConversation = (options: ControllerOptions) => {
  const controller = createRealtimeConversationController(options)
  const snapshot = shallowRef<RealtimeConversationSnapshot>(controller.getSnapshot())
  controller.subscribe((nextSnapshot) => {
    snapshot.value = nextSnapshot
  })

  const capability = computed({
    get: () => snapshot.value.capability,
    set: (value: RealtimeCapability) => controller.setCapability(value)
  })
  const previewError = computed({
    get: () => snapshot.value.previewError,
    set: (value: string | null) => controller.setPreviewError(value)
  })

  return {
    capability,
    state: computed(() => snapshot.value.state),
    activity: computed(() => snapshot.value.activity),
    sessionKind: computed(() => snapshot.value.sessionKind),
    activeVoice: computed(() => snapshot.value.activeVoice),
    owningThreadId: computed(() => snapshot.value.owningThreadId),
    generation: computed(() => snapshot.value.generation),
    transcripts: computed(() => snapshot.value.transcripts),
    latestUserTranscript: computed(() => snapshot.value.latestUserTranscript),
    error: computed(() => snapshot.value.error),
    outputMuted: computed(() => snapshot.value.outputMuted),
    autoplayBlocked: computed(() => snapshot.value.autoplayBlocked),
    microphoneEnabled: computed(() => snapshot.value.microphoneEnabled),
    remoteAudioActive: computed(() => snapshot.value.remoteAudioActive),
    peerConnectionState: computed(() => snapshot.value.peerConnectionState),
    voiceCatalog: computed(() => snapshot.value.voiceCatalog),
    previewStatus: computed(() => snapshot.value.previewStatus),
    previewError,
    refreshCapability: controller.refreshCapability,
    refreshVoiceCatalog: controller.refreshVoiceCatalog,
    invalidateVoiceCatalog: controller.invalidateVoiceCatalog,
    connect: (
      threadId: string,
      connectOptions: RealtimeConnectOptions = {}
    ) => controller.connect(threadId, connectOptions),
    setMicrophoneEnabled: controller.setMicrophoneEnabled,
    setOutputMuted: controller.setOutputMuted,
    stop: controller.stop,
    stopForReplacement: controller.stopForReplacement,
    stopForThreadChange: controller.stopForThreadChange,
    dispose: controller.dispose
  }
}

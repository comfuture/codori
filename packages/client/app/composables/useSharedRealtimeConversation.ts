import { computed, shallowRef, watch } from 'vue'
import type { CodexRpcClient } from '~~/shared/codex-rpc'
import { useRealtimeConversation } from './useRealtimeConversation'

type RealtimeConversationController = ReturnType<typeof useRealtimeConversation>

type RealtimeConversationEntry = {
  workspaceKey: string
  getClient: () => CodexRpcClient
  controller: RealtimeConversationController
}

type ActiveRealtimeConversation = {
  entry: RealtimeConversationEntry
  threadId: string
}

const entries = new Map<string, RealtimeConversationEntry>()
const activeConversation = shallowRef<ActiveRealtimeConversation | null>(null)

const createEntry = (
  workspaceKey: string,
  getClient: () => CodexRpcClient
): RealtimeConversationEntry => {
  const client = {
    request: async <T>(method: string, params?: unknown) =>
      await getClient().request<T>(method, params),
    subscribe: (listener: Parameters<CodexRpcClient['subscribe']>[0]) =>
      getClient().subscribe(listener),
    subscribeConnectionState: (
      listener: Parameters<CodexRpcClient['subscribeConnectionState']>[0]
    ) => getClient().subscribeConnectionState(listener),
    isConnected: () => getClient().isConnected()
  }
  const controller = useRealtimeConversation({ client })
  const entry = {
    workspaceKey,
    getClient,
    controller
  }

  watch(controller.owningThreadId, (threadId) => {
    const active = activeConversation.value
    if (active?.entry !== entry) {
      return
    }
    if (!threadId) {
      activeConversation.value = null
      return
    }
    activeConversation.value = {
      entry,
      threadId
    }
  })

  return entry
}

const getEntry = (workspaceKey: string, getClient: () => CodexRpcClient) => {
  const existing = entries.get(workspaceKey)
  if (existing) {
    return existing
  }

  const entry = createEntry(workspaceKey, getClient)
  entries.set(workspaceKey, entry)
  return entry
}

export const isRealtimeVoiceActiveElsewhere = (input: {
  activeWorkspaceKey: string | null
  activeThreadId: string | null
  workspaceKey: string
  threadId: string | null
}) =>
  Boolean(
    input.activeWorkspaceKey
    && input.activeThreadId
    && (
      input.activeWorkspaceKey !== input.workspaceKey
      || input.activeThreadId !== input.threadId
    )
  )

export const useActiveRealtimeConversation = () => {
  const controller = computed(() =>
    activeConversation.value?.entry.controller ?? null
  )

  return {
    activeWorkspaceKey: computed(() =>
      activeConversation.value?.entry.workspaceKey ?? null
    ),
    activeThreadId: computed(() =>
      activeConversation.value?.threadId ?? null
    ),
    activeClient: computed(() =>
      activeConversation.value?.entry.getClient() ?? null
    ),
    state: computed(() => controller.value?.state.value ?? 'idle'),
    activity: computed(() => controller.value?.activity.value ?? 'idle'),
    generation: computed(() => controller.value?.generation.value ?? 0),
    transcripts: computed(() => controller.value?.transcripts.value ?? [])
  }
}

export const useSharedRealtimeConversation = (
  workspaceKey: string,
  getClient: () => CodexRpcClient
) => {
  const entry = getEntry(workspaceKey, getClient)
  const displayController = computed(() =>
    activeConversation.value?.entry.controller ?? entry.controller
  )
  const activeWorkspaceKey = computed(() =>
    activeConversation.value?.entry.workspaceKey ?? null
  )
  const activeClient = computed(() =>
    activeConversation.value?.entry.getClient() ?? null
  )
  const owningThreadId = computed(() =>
    activeConversation.value?.threadId ?? null
  )

  const connect = async (threadId: string) => {
    const active = activeConversation.value
    if (active) {
      if (active.entry === entry && active.threadId === threadId) {
        return
      }
      throw new Error('A voice session is already active in another thread.')
    }

    activeConversation.value = {
      entry,
      threadId
    }
    try {
      await entry.controller.connect(threadId)
    } catch (error) {
      if (activeConversation.value?.entry === entry
        && !entry.controller.owningThreadId.value) {
        activeConversation.value = null
      }
      throw error
    }
  }

  const activeController = () =>
    activeConversation.value?.entry.controller ?? entry.controller

  return {
    capability: entry.controller.capability,
    state: computed(() => displayController.value.state.value),
    activity: computed(() => displayController.value.activity.value),
    owningThreadId,
    activeWorkspaceKey,
    activeClient,
    generation: computed(() => displayController.value.generation.value),
    transcripts: computed(() => displayController.value.transcripts.value),
    latestUserTranscript: computed(() => displayController.value.latestUserTranscript.value),
    error: computed(() => displayController.value.error.value),
    outputMuted: computed(() => displayController.value.outputMuted.value),
    autoplayBlocked: computed(() => displayController.value.autoplayBlocked.value),
    microphoneEnabled: computed(() => displayController.value.microphoneEnabled.value),
    remoteAudioActive: computed(() => displayController.value.remoteAudioActive.value),
    peerConnectionState: computed(() => displayController.value.peerConnectionState.value),
    refreshCapability: entry.controller.refreshCapability,
    connect,
    setMicrophoneEnabled: (enabled: boolean) =>
      activeController().setMicrophoneEnabled(enabled),
    setOutputMuted: (muted: boolean) =>
      activeController().setOutputMuted(muted),
    stop: () => activeController().stop(),
    dispose: () => activeController().dispose()
  }
}

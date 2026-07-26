import { computed, effectScope, shallowRef, watch } from 'vue'
import type { CodexRpcClient } from '~~/shared/codex-rpc'
import {
  useRealtimeConversation,
  type RealtimeConnectOptions
} from './useRealtimeConversation'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'

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
const ownershipScope = effectScope(true)
let ownershipClaim: Promise<void> | null = null

const acquireOwnershipClaim = async () => {
  while (ownershipClaim) {
    await ownershipClaim
  }

  let settleClaim!: () => void
  const claim = new Promise<void>((resolve) => {
    settleClaim = resolve
  })
  ownershipClaim = claim
  let released = false
  return () => {
    if (released) {
      return
    }
    released = true
    if (ownershipClaim === claim) {
      ownershipClaim = null
    }
    settleClaim()
  }
}

const waitForControllerOwnership = async (
  controller: RealtimeConversationController,
  threadId: string,
  connectPromise: Promise<void>
) => {
  if (controller.owningThreadId.value === threadId) {
    return true
  }

  let releaseWatch = () => {}
  const ownershipReady = new Promise<void>((resolve) => {
    releaseWatch = watch(controller.owningThreadId, (owningThreadId) => {
      if (owningThreadId === threadId) {
        releaseWatch()
        resolve()
      }
    }, { flush: 'sync' })
  })
  await Promise.race([
    ownershipReady,
    connectPromise.then(() => undefined, () => undefined)
  ])
  releaseWatch()
  return controller.owningThreadId.value === threadId
}

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

  ownershipScope.run(() => {
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

export const promoteSharedRealtimeConversation = (
  sourceWorkspaceKey: string,
  targetWorkspaceKey: string
) => {
  if (sourceWorkspaceKey === targetWorkspaceKey || entries.has(targetWorkspaceKey)) {
    return
  }

  const entry = entries.get(sourceWorkspaceKey)
  if (!entry) {
    return
  }

  entry.workspaceKey = targetWorkspaceKey
  entries.set(targetWorkspaceKey, entry)
  entries.delete(sourceWorkspaceKey)
}

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
    sessionKind: computed(() => controller.value?.sessionKind.value ?? null),
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
  const ownsActiveSession = computed(() =>
    activeConversation.value?.entry === entry
  )

  const connect = async (
    threadId: string,
    options: RealtimeConnectOptions = {}
  ) => {
    const releaseOwnershipClaim = await acquireOwnershipClaim()
    let connectPromise!: Promise<void>
    try {
      const active = activeConversation.value
      if (active) {
        if (active.entry === entry
          && active.threadId === threadId
          && active.entry.controller.sessionKind.value === (options.kind ?? 'conversation')
          && active.entry.controller.activeVoice.value === (options.voice ?? null)) {
          return
        }
        if (active.entry.controller.sessionKind.value !== 'preview') {
          throw new Error('A voice session is already active in another thread.')
        }
        await active.entry.controller.stopForReplacement()
        if (activeConversation.value === active) {
          activeConversation.value = null
        }
      }

      activeConversation.value = {
        entry,
        threadId
      }
      connectPromise = entry.controller.connect(threadId, options)
      const ownsRequestedThread = await waitForControllerOwnership(
        entry.controller,
        threadId,
        connectPromise
      )
      if (!ownsRequestedThread) {
        if (activeConversation.value?.entry === entry
          && !entry.controller.owningThreadId.value) {
          activeConversation.value = null
        }
        await connectPromise
        return
      }
    } finally {
      releaseOwnershipClaim()
    }

    try {
      await connectPromise
    } catch (error) {
      if (activeConversation.value?.entry === entry
        && !entry.controller.owningThreadId.value) {
        activeConversation.value = null
      }
      throw error
    }
  }

  const preview = async (threadId: string, voice: RealtimeVoice, text: string) => {
    try {
      await connect(threadId, {
        kind: 'preview',
        voice,
        previewText: text
      })
    } catch (error) {
      entry.controller.previewError.value = error instanceof Error
        ? error.message
        : String(error)
      throw error
    }
  }

  const activeController = () =>
    activeConversation.value?.entry.controller ?? entry.controller

  return {
    capability: entry.controller.capability,
    state: computed(() => displayController.value.state.value),
    sessionKind: computed(() => displayController.value.sessionKind.value),
    activeVoice: computed(() => displayController.value.activeVoice.value),
    activity: computed(() => displayController.value.activity.value),
    owningThreadId,
    activeWorkspaceKey,
    activeClient,
    ownsActiveSession,
    generation: computed(() => displayController.value.generation.value),
    transcripts: computed(() => displayController.value.transcripts.value),
    latestUserTranscript: computed(() => displayController.value.latestUserTranscript.value),
    error: computed(() => displayController.value.error.value),
    outputMuted: computed(() => displayController.value.outputMuted.value),
    autoplayBlocked: computed(() => displayController.value.autoplayBlocked.value),
    microphoneEnabled: computed(() => displayController.value.microphoneEnabled.value),
    remoteAudioActive: computed(() => displayController.value.remoteAudioActive.value),
    peerConnectionState: computed(() => displayController.value.peerConnectionState.value),
    voiceCatalog: entry.controller.voiceCatalog,
    previewStatus: computed(() => displayController.value.previewStatus.value),
    previewError: computed(() => displayController.value.previewError.value),
    refreshCapability: entry.controller.refreshCapability,
    refreshVoiceCatalog: entry.controller.refreshVoiceCatalog,
    invalidateVoiceCatalog: entry.controller.invalidateVoiceCatalog,
    connect,
    preview,
    setMicrophoneEnabled: (enabled: boolean) =>
      activeController().setMicrophoneEnabled(enabled),
    setOutputMuted: (muted: boolean) =>
      activeController().setOutputMuted(muted),
    stop: () => activeController().stop(),
    dispose: () => activeController().dispose()
  }
}

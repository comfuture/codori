import { effectScope, nextTick, type ComputedRef, type Ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type {
  RealtimeActivity,
  RealtimeCapability,
  RealtimeSessionKind,
  RealtimeSessionState,
  RealtimeTranscriptSegment,
  RealtimeVoiceCatalog,
  RealtimeVoicePreviewStatus
} from '../app/composables/useRealtimeConversation'
import type { RealtimeVoice } from '../shared/generated/codex-app-server/RealtimeVoice'
import {
  promoteSharedRealtimeConversation,
  useActiveRealtimeConversation,
  useSharedRealtimeConversation
} from '../app/composables/useSharedRealtimeConversation'
import type { CodexRpcClient } from '../shared/codex-rpc'

type MockController = {
  capability: Ref<RealtimeCapability>
  state: Ref<RealtimeSessionState>
  sessionKind: Ref<RealtimeSessionKind | null>
  activeVoice: Ref<RealtimeVoice | null>
  activity: Ref<RealtimeActivity>
  owningThreadId: Ref<string | null>
  generation: Ref<number>
  transcripts: Ref<RealtimeTranscriptSegment[]>
  latestUserTranscript: ComputedRef<string | null>
  error: Ref<string | null>
  outputMuted: Ref<boolean>
  autoplayBlocked: Ref<boolean>
  microphoneEnabled: Ref<boolean>
  remoteAudioActive: Ref<boolean>
  peerConnectionState: Ref<RTCPeerConnectionState | null>
  voiceCatalog: Ref<RealtimeVoiceCatalog>
  previewStatus: ComputedRef<RealtimeVoicePreviewStatus>
  previewError: Ref<string | null>
  refreshCapability: ReturnType<typeof vi.fn>
  refreshVoiceCatalog: ReturnType<typeof vi.fn>
  invalidateVoiceCatalog: ReturnType<typeof vi.fn>
  connect: ReturnType<typeof vi.fn>
  setMicrophoneEnabled: ReturnType<typeof vi.fn>
  setOutputMuted: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  stopForReplacement: ReturnType<typeof vi.fn>
  stopForThreadChange: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

vi.mock('../app/composables/useRealtimeConversation', async () => {
  const { computed, ref } = await vi.importActual<typeof import('vue')>('vue')

  return {
    useRealtimeConversation: () => {
      const owningThreadId = ref<string | null>(null)
      const sessionKind = ref<RealtimeSessionKind | null>(null)
      const activeVoice = ref<RealtimeVoice | null>(null)
      const controller: MockController = {
        capability: ref({
          status: 'available',
          message: 'Realtime voice is available.'
        }),
        state: ref('idle'),
        sessionKind,
        activeVoice,
        activity: ref('idle'),
        owningThreadId,
        generation: ref(0),
        transcripts: ref([]),
        latestUserTranscript: computed(() => null),
        error: ref(null),
        outputMuted: ref(false),
        autoplayBlocked: ref(false),
        microphoneEnabled: ref(false),
        remoteAudioActive: ref(false),
        peerConnectionState: ref(null),
        voiceCatalog: ref({
          status: 'ready',
          voices: ['cove'],
          protocolDefault: 'cove',
          error: null
        }),
        previewStatus: computed(() =>
          sessionKind.value === 'preview' ? 'playing' : 'idle'
        ),
        previewError: ref(null),
        refreshCapability: vi.fn(),
        refreshVoiceCatalog: vi.fn(),
        invalidateVoiceCatalog: vi.fn(),
        connect: vi.fn(async (
          threadId: string,
          options?: { kind?: RealtimeSessionKind, voice?: RealtimeVoice }
        ) => {
          owningThreadId.value = threadId
          sessionKind.value = options?.kind ?? 'conversation'
          activeVoice.value = options?.voice ?? null
        }),
        setMicrophoneEnabled: vi.fn(),
        setOutputMuted: vi.fn(),
        stop: vi.fn(async () => {
          owningThreadId.value = null
          sessionKind.value = null
          activeVoice.value = null
        }),
        stopForReplacement: vi.fn(async () => {
          owningThreadId.value = null
          sessionKind.value = null
          activeVoice.value = null
        }),
        stopForThreadChange: vi.fn(),
        dispose: vi.fn(async () => {
          owningThreadId.value = null
        })
      }
      return controller
    }
  }
})

const client = {} as CodexRpcClient

describe('shared realtime conversation lifecycle', () => {
  it('keeps ownership synchronization alive after the creating scope stops', async () => {
    const workspaceKey = 'chat:scope-lifecycle'
    const scope = effectScope()
    const conversation = scope.run(() =>
      useSharedRealtimeConversation(workspaceKey, () => client)
    )!

    await conversation.connect('thread-scope-lifecycle')
    expect(useActiveRealtimeConversation().activeWorkspaceKey.value).toBe(workspaceKey)

    scope.stop()
    await conversation.stop()
    await nextTick()

    expect(useActiveRealtimeConversation().activeWorkspaceKey.value).toBeNull()
    expect(useActiveRealtimeConversation().activeThreadId.value).toBeNull()
  })

  it('promotes an active draft conversation to the allocated chat key', async () => {
    const draftKey = 'chat:draft-promotion'
    const chatKey = 'chat:allocated-promotion'
    const draftConversation = useSharedRealtimeConversation(draftKey, () => client)

    await draftConversation.connect('thread-draft-promotion')
    expect(draftConversation.ownsActiveSession.value).toBe(true)
    promoteSharedRealtimeConversation(draftKey, chatKey)

    const active = useActiveRealtimeConversation()
    expect(active.activeWorkspaceKey.value).toBe(chatKey)
    expect(active.activeThreadId.value).toBe('thread-draft-promotion')
    expect(useSharedRealtimeConversation(chatKey, () => client).owningThreadId.value)
      .toBe('thread-draft-promotion')
    expect(draftConversation.ownsActiveSession.value).toBe(true)

    await draftConversation.stop()
    await nextTick()
  })

  it('serializes preview replacement and lets a conversation preempt it', async () => {
    const workspaceKey = 'project:preview-preemption'
    const conversation = useSharedRealtimeConversation(workspaceKey, () => client)

    await conversation.preview('thread-preview', 'cove', 'Preview')
    expect(conversation.sessionKind.value).toBe('preview')
    expect(conversation.activeVoice.value).toBe('cove')

    await conversation.connect('thread-preview', { voice: 'cove' })
    expect(conversation.sessionKind.value).toBe('conversation')
    expect(conversation.activeVoice.value).toBe('cove')

    await conversation.stop()
    await nextTick()
  })
})

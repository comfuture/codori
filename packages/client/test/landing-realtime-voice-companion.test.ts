import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import {
  createLandingRealtimeVoiceCompanion,
  LANDING_VOICE_DEVELOPER_INSTRUCTIONS,
  LANDING_VOICE_MODEL,
  LANDING_VOICE_REASONING_EFFORT,
  type LandingRealtimeVoiceCompanionDependencies
} from '../app/composables/useLandingRealtimeVoiceCompanion'
import { matchesLandingRealtimeVoicePresentation } from '../app/composables/useLandingRealtimeVoicePresentation'
import type { CodexRpcClient } from '../shared/codex-rpc'
import type { ChatSessionRecord } from '../shared/codori'

const chat: ChatSessionRecord = {
  chatId: 'chat-voice',
  chatPath: '/tmp/chat-voice',
  threadId: null,
  title: null,
  createdAt: 1,
  updatedAt: null,
  status: 'running',
  pid: 100,
  port: 4100,
  startedAt: 1,
  lastActivityAt: 1,
  activeSessionCount: 1,
  idleTimeoutMs: null,
  idleDeadlineAt: null,
  error: null
}

const createFixture = (input?: {
  configured?: boolean
  connectError?: Error
  ownsActiveSession?: boolean
  hasActiveSession?: boolean
}) => {
  const order: string[] = []
  const request = vi.fn(async (method: string) => {
    order.push(method)
    if (method === 'thread/start') {
      return {
        thread: {
          id: 'thread-voice'
        }
      }
    }
    if (method === 'config/read') {
      return {
        config: {}
      }
    }
    return {}
  })
  const client = { request } as unknown as CodexRpcClient
  const showPresentation = vi.fn(() => {
    order.push('show-presentation')
  })
  const clearPresentation = vi.fn()
  const stop = vi.fn(async () => {
    order.push('stop')
  })
  const connect = vi.fn(async () => {
    order.push('connect')
    if (input?.connectError) {
      throw input.connectError
    }
  })
  const dependencies: LandingRealtimeVoiceCompanionDependencies = {
    activeChatId: ref(null),
    voiceCatalog: ref({
      status: 'ready',
      voices: ['cove'],
      protocolDefault: 'cove',
      error: null
    }),
    savedVoice: ref('cove'),
    savedPrompt: ref('Use the saved landing prompt.'),
    hasActiveSession: () => input?.hasActiveSession ?? false,
    ownsActiveSession: () => input?.ownsActiveSession ?? false,
    fetchCapabilities: vi.fn(async () => {
      order.push('capabilities')
      return {
        capabilities: {
          realtimeVoice: {
            configured: input?.configured ?? true,
            experimental: true as const,
            feature: 'realtime_conversation' as const
          }
        }
      }
    }),
    createChat: vi.fn(async () => {
      order.push('create-chat')
      return chat
    }),
    setChatThread: vi.fn(async () => {
      order.push('set-chat-thread')
    }),
    getChatClient: vi.fn(() => {
      order.push('get-chat-client')
      return client
    }),
    promoteConversation: vi.fn(() => {
      order.push('promote-conversation')
    }),
    realtimeVoice: {
      refreshCapability: vi.fn(async () => {
        order.push('refresh-capability')
        return {
          status: 'available',
          message: 'Realtime voice is available.'
        }
      }),
      refreshVoiceCatalog: vi.fn(async () => {
        order.push('refresh-voice-catalog')
      }),
      connect,
      stop,
      setMicrophoneEnabled: vi.fn(() => {
        order.push('enable-microphone')
      })
    },
    showPresentation,
    clearPresentation
  }

  return {
    order,
    request,
    dependencies,
    connect,
    stop,
    showPresentation,
    clearPresentation
  }
}

describe('landing realtime voice companion startup', () => {
  it('creates and configures one projectless Luna thread before connecting voice', async () => {
    const fixture = createFixture()
    const companion = createLandingRealtimeVoiceCompanion(fixture.dependencies)

    await companion.start()

    expect(companion.error.value).toBeNull()
    expect(companion.pending.value).toBe(false)
    expect(fixture.dependencies.activeChatId.value).toBe('chat-voice')
    expect(fixture.order).toEqual([
      'capabilities',
      'create-chat',
      'get-chat-client',
      'thread/start',
      'thread/settings/update',
      'set-chat-thread',
      'promote-conversation',
      'refresh-capability',
      'refresh-voice-catalog',
      'config/read',
      'show-presentation',
      'connect',
      'enable-microphone'
    ])
    expect(fixture.request).toHaveBeenNthCalledWith(1, 'thread/start', {
      model: LANDING_VOICE_MODEL,
      cwd: null,
      approvalPolicy: 'never',
      developerInstructions: LANDING_VOICE_DEVELOPER_INSTRUCTIONS,
      experimentalRawEvents: false
    })
    expect(fixture.request).toHaveBeenNthCalledWith(2, 'thread/settings/update', {
      threadId: 'thread-voice',
      model: LANDING_VOICE_MODEL,
      effort: LANDING_VOICE_REASONING_EFFORT
    })
    expect(fixture.dependencies.setChatThread).toHaveBeenCalledWith(
      'chat-voice',
      'thread-voice'
    )
    expect(fixture.connect).toHaveBeenCalledWith('thread-voice', {
      voice: 'cove',
      prompt: 'Use the saved landing prompt.'
    })
    expect(fixture.showPresentation).toHaveBeenCalledWith({
      workspaceKey: 'chat:chat-voice',
      threadId: 'thread-voice'
    })
    expect(LANDING_VOICE_DEVELOPER_INSTRUCTIONS).toContain('current voice companion')
    expect(LANDING_VOICE_DEVELOPER_INSTRUCTIONS).toContain('pwd')
    expect(LANDING_VOICE_DEVELOPER_INSTRUCTIONS).toContain('Codori project threads')
    expect(LANDING_VOICE_DEVELOPER_INSTRUCTIONS).toContain('computer hosting Codori')
  })

  it('does not create history when realtime voice is disabled or already active', async () => {
    const disabled = createFixture({ configured: false })
    const disabledCompanion = createLandingRealtimeVoiceCompanion(disabled.dependencies)
    await disabledCompanion.start()

    expect(disabledCompanion.error.value).toBe(
      'Experimental realtime voice is disabled in Codori.'
    )
    expect(disabled.dependencies.createChat).not.toHaveBeenCalled()

    const active = createFixture({ hasActiveSession: true })
    const activeCompanion = createLandingRealtimeVoiceCompanion(active.dependencies)
    await activeCompanion.start()

    expect(activeCompanion.error.value).toBe(
      'A voice session is already active in another thread.'
    )
    expect(active.dependencies.fetchCapabilities).not.toHaveBeenCalled()
  })

  it('cleans up provisional ownership and exposes a connection failure', async () => {
    const fixture = createFixture({
      connectError: new Error('Microphone permission denied.'),
      ownsActiveSession: true
    })
    const companion = createLandingRealtimeVoiceCompanion(fixture.dependencies)

    await companion.start()

    expect(companion.pending.value).toBe(false)
    expect(companion.error.value).toBe('Microphone permission denied.')
    expect(fixture.showPresentation).toHaveBeenCalledWith({
      workspaceKey: 'chat:chat-voice',
      threadId: 'thread-voice'
    })
    expect(fixture.clearPresentation).toHaveBeenCalledWith({
      workspaceKey: 'chat:chat-voice',
      threadId: 'thread-voice'
    })
    expect(fixture.stop).toHaveBeenCalledOnce()
  })
})

describe('landing realtime voice presentation identity', () => {
  it('matches only the active workspace and thread pair', () => {
    const presentation = {
      workspaceKey: 'chat:chat-voice',
      threadId: 'thread-voice'
    }

    expect(matchesLandingRealtimeVoicePresentation(
      presentation,
      'chat:chat-voice',
      'thread-voice'
    )).toBe(true)
    expect(matchesLandingRealtimeVoicePresentation(
      presentation,
      'chat:another',
      'thread-voice'
    )).toBe(false)
    expect(matchesLandingRealtimeVoicePresentation(
      presentation,
      'chat:chat-voice',
      'thread-another'
    )).toBe(false)
  })
})

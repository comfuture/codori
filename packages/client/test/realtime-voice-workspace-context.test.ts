import { afterEach, describe, expect, it } from 'vitest'
import {
  clearRealtimeVoiceWorkspaceContext,
  rememberRealtimeVoiceWorkspaceContext,
  useRealtimeVoiceWorkspaceContext
} from '../app/composables/useRealtimeVoiceWorkspaceContext'

afterEach(() => {
  clearRealtimeVoiceWorkspaceContext()
})

describe('realtime voice workspace context', () => {
  it('remembers only a materialized workspace and thread', () => {
    rememberRealtimeVoiceWorkspaceContext({
      workspace: {
        kind: 'project',
        id: 'codori'
      },
      workspaceKey: 'project:codori',
      threadId: 'thread-1'
    })

    expect(useRealtimeVoiceWorkspaceContext().value).toEqual({
      workspace: {
        kind: 'project',
        id: 'codori'
      },
      workspaceKey: 'project:codori',
      threadId: 'thread-1'
    })
  })

  it('does not replace a valid context with provisional values', () => {
    rememberRealtimeVoiceWorkspaceContext({
      workspace: {
        kind: 'chat',
        id: 'chat-1'
      },
      workspaceKey: 'chat:chat-1',
      threadId: 'thread-1'
    })
    rememberRealtimeVoiceWorkspaceContext({
      workspace: {
        kind: 'chat',
        id: ''
      },
      workspaceKey: 'chat:draft',
      threadId: ''
    })

    expect(useRealtimeVoiceWorkspaceContext().value?.workspaceKey).toBe('chat:chat-1')
  })
})

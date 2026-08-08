import { describe, expect, it } from 'vitest'
import {
  resolveRealtimeVoiceHandoffAction,
  shouldDisposeRealtimeVoiceOnPageHide,
  shouldHandoffRealtimeVoiceConnect
} from '../app/utils/realtime-voice-handoff'

describe('realtime voice route handoff', () => {
  it('keeps voice state alive when pagehide enters the back-forward cache', () => {
    expect(shouldDisposeRealtimeVoiceOnPageHide(true)).toBe(false)
    expect(shouldDisposeRealtimeVoiceOnPageHide(false)).toBe(true)
  })

  it('hands a draft project voice request to the auto-redirected workspace', () => {
    expect(shouldHandoffRealtimeVoiceConnect({
      workspaceKind: 'project',
      routeThreadId: null,
      pendingThreadId: 'thread-voice',
      autoRedirectThreadId: null,
      threadId: 'thread-voice'
    })).toBe(true)

    expect(shouldHandoffRealtimeVoiceConnect({
      workspaceKind: 'project',
      routeThreadId: null,
      pendingThreadId: null,
      autoRedirectThreadId: 'thread-voice',
      threadId: 'thread-voice'
    })).toBe(true)
  })

  it('does not hand off existing project threads or chat sessions', () => {
    expect(shouldHandoffRealtimeVoiceConnect({
      workspaceKind: 'project',
      routeThreadId: 'thread-voice',
      pendingThreadId: null,
      autoRedirectThreadId: null,
      threadId: 'thread-voice'
    })).toBe(false)

    expect(shouldHandoffRealtimeVoiceConnect({
      workspaceKind: 'chat',
      routeThreadId: null,
      pendingThreadId: 'thread-voice',
      autoRedirectThreadId: null,
      threadId: 'thread-voice'
    })).toBe(false)
  })

  it('connects only after the remounted workspace and capability are ready', () => {
    expect(resolveRealtimeVoiceHandoffAction({
      pendingThreadId: 'thread-voice',
      routeThreadId: null,
      activeThreadId: 'thread-voice',
      capabilityStatus: 'available'
    })).toBe('wait')

    expect(resolveRealtimeVoiceHandoffAction({
      pendingThreadId: 'thread-voice',
      routeThreadId: 'thread-voice',
      activeThreadId: 'thread-voice',
      capabilityStatus: 'checking'
    })).toBe('wait')

    expect(resolveRealtimeVoiceHandoffAction({
      pendingThreadId: 'thread-voice',
      routeThreadId: 'thread-voice',
      activeThreadId: 'thread-voice',
      capabilityStatus: 'available'
    })).toBe('connect')
  })

  it('clears a stale or unavailable handoff instead of connecting the wrong thread', () => {
    expect(resolveRealtimeVoiceHandoffAction({
      pendingThreadId: 'thread-voice',
      routeThreadId: 'thread-other',
      activeThreadId: 'thread-other',
      capabilityStatus: 'available'
    })).toBe('clear')

    expect(resolveRealtimeVoiceHandoffAction({
      pendingThreadId: 'thread-voice',
      routeThreadId: 'thread-voice',
      activeThreadId: 'thread-voice',
      capabilityStatus: 'failed'
    })).toBe('clear')
  })
})

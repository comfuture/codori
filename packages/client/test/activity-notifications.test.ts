import { describe, expect, it } from 'vitest'
import {
  compactNotificationText,
  extractActivityNotificationCandidate,
  selectActivityNotificationSurface
} from '../app/utils/activity-notifications'
import type { CodexRpcNotification } from '../shared/codex-rpc'

const completedMessage = (input: {
  phase?: 'commentary' | 'final_answer' | null
  text?: string
  itemType?: string
} = {}) => ({
  method: 'item/completed',
  params: {
    threadId: 'thread-1',
    turnId: 'turn-1',
    completedAtMs: 1,
    item: {
      type: input.itemType ?? 'agentMessage',
      id: 'item-1',
      text: input.text ?? 'The task is ready.',
      phase: input.phase === undefined ? 'final_answer' : input.phase,
      memoryCitation: null
    }
  }
}) as CodexRpcNotification

describe('activity notification policy', () => {
  it('extracts only completed assistant text that merits attention', () => {
    expect(extractActivityNotificationCandidate(completedMessage())).toEqual({
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      text: 'The task is ready.'
    })
    expect(extractActivityNotificationCandidate(completedMessage({
      phase: 'commentary'
    }))).toBeNull()
    expect(extractActivityNotificationCandidate(completedMessage({
      text: '   '
    }))).toBeNull()
    expect(extractActivityNotificationCandidate(completedMessage({
      itemType: 'reasoning'
    }))).toBeNull()
  })

  it('suppresses the current visible thread and uses exactly one background surface', () => {
    expect(selectActivityNotificationSurface({
      documentVisible: true,
      windowFocused: true,
      viewingThread: true,
      systemNotificationsEnabled: true
    })).toBe('none')
    expect(selectActivityNotificationSurface({
      documentVisible: true,
      windowFocused: true,
      viewingThread: false,
      systemNotificationsEnabled: true
    })).toBe('toast')
    expect(selectActivityNotificationSurface({
      documentVisible: false,
      windowFocused: false,
      viewingThread: true,
      systemNotificationsEnabled: true
    })).toBe('system')
    expect(selectActivityNotificationSurface({
      documentVisible: false,
      windowFocused: false,
      viewingThread: false,
      systemNotificationsEnabled: false
    })).toBe('none')
  })

  it('compacts notification text without returning an oversized preview', () => {
    expect(compactNotificationText('one\n\n two')).toBe('one two')
    expect(compactNotificationText('123456789', 6)).toBe('12345…')
  })
})

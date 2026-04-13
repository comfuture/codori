import { describe, expect, it } from 'vitest'
import {
  replaceStreamingMessage,
  upsertStreamingMessage,
  type ChatMessage
} from '../shared/codex-chat'
import { mergeThreadSummary, renameThreadSummary } from '../app/composables/useThreadSummaries'
import { resolveChatMessagesStatus } from '../app/utils/chat-messages-status'

describe('chat transcript stability', () => {
  it('replaces a streamed text message with the completed server payload', () => {
    const streamedMessages = upsertStreamingMessage([], {
      id: 'agent-1',
      role: 'assistant',
      pending: true,
      parts: [{
        type: 'text',
        text: 'Partial reply',
        state: 'streaming'
      }, {
        type: 'reasoning',
        summary: ['Thinking'],
        content: ['Hidden merge residue'],
        state: 'streaming'
      }]
    })

    expect(replaceStreamingMessage(streamedMessages, {
      id: 'agent-1',
      role: 'assistant',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Final reply',
        state: 'done'
      }]
    })).toEqual<ChatMessage[]>([{
      id: 'agent-1',
      role: 'assistant',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Final reply',
        state: 'done'
      }]
    }])
  })

  it('replaces streamed reasoning with the completed reasoning payload', () => {
    const streamedMessages = upsertStreamingMessage([], {
      id: 'reasoning-1',
      role: 'assistant',
      pending: true,
      parts: [{
        type: 'reasoning',
        summary: ['Thinking...'],
        content: ['step 1'],
        state: 'streaming'
      }]
    })

    expect(replaceStreamingMessage(streamedMessages, {
      id: 'reasoning-1',
      role: 'assistant',
      pending: false,
      parts: [{
        type: 'reasoning',
        summary: ['Plan'],
        content: ['Final explanation'],
        state: 'done'
      }]
    })).toEqual<ChatMessage[]>([{
      id: 'reasoning-1',
      role: 'assistant',
      pending: false,
      parts: [{
        type: 'reasoning',
        summary: ['Plan'],
        content: ['Final explanation'],
        state: 'done'
      }]
    }])
  })

  it('keeps chat loading state in submitted mode until real assistant output appears', () => {
    expect(resolveChatMessagesStatus('submitted', true)).toBe('submitted')
    expect(resolveChatMessagesStatus('streaming', true)).toBe('submitted')
    expect(resolveChatMessagesStatus('streaming', false)).toBe('streaming')
    expect(resolveChatMessagesStatus('ready', true)).toBe('ready')
  })

  it('updates cached thread summaries in place when a live title arrives', () => {
    expect(renameThreadSummary([{
      id: 'thread-1',
      title: 'Thread abc123',
      updatedAt: 1
    }, {
      id: 'thread-2',
      title: 'Older thread',
      updatedAt: 0
    }], {
      threadId: 'thread-1',
      title: 'Investigate optimistic submit bug',
      updatedAt: 2
    })).toEqual([{
      id: 'thread-1',
      title: 'Investigate optimistic submit bug',
      updatedAt: 2
    }, {
      id: 'thread-2',
      title: 'Older thread',
      updatedAt: 0
    }])
  })

  it('keeps thread summaries ordered by recency when inserting new threads', () => {
    expect(mergeThreadSummary([{
      id: 'thread-1',
      title: 'Existing thread',
      updatedAt: 1
    }], {
      id: 'thread-2',
      title: 'Newest thread',
      updatedAt: 3
    })).toEqual([{
      id: 'thread-2',
      title: 'Newest thread',
      updatedAt: 3
    }, {
      id: 'thread-1',
      title: 'Existing thread',
      updatedAt: 1
    }])
  })
})

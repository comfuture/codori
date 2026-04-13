import { describe, expect, it } from 'vitest'
import {
  replaceStreamingMessage,
  upsertStreamingMessage,
  type ChatMessage
} from '../shared/codex-chat'

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
})

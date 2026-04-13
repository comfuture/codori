import { describe, expect, it } from 'vitest'
import {
  hideThinkingPlaceholder,
  replaceStreamingMessage,
  showThinkingPlaceholder,
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

  it('adds a single thinking placeholder while the assistant has not produced content yet', () => {
    const withPlaceholder = showThinkingPlaceholder([{
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Investigate the bug.',
        state: 'done'
      }]
    }])

    expect(showThinkingPlaceholder(withPlaceholder)).toEqual(withPlaceholder)
    expect(withPlaceholder.at(-1)).toEqual<ChatMessage>({
      id: 'assistant-thinking-placeholder',
      role: 'assistant',
      pending: true,
      parts: [{
        type: 'reasoning',
        summary: ['Thinking...'],
        content: [],
        state: 'streaming'
      }]
    })
  })

  it('removes the thinking placeholder once real assistant content starts', () => {
    expect(hideThinkingPlaceholder(showThinkingPlaceholder([{
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Investigate the bug.',
        state: 'done'
      }]
    }, {
      id: 'agent-1',
      role: 'assistant',
      pending: true,
      parts: [{
        type: 'text',
        text: 'Looking into it',
        state: 'streaming'
      }]
    }]))).toEqual<ChatMessage[]>([{
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Investigate the bug.',
        state: 'done'
      }]
    }, {
      id: 'agent-1',
      role: 'assistant',
      pending: true,
      parts: [{
        type: 'text',
        text: 'Looking into it',
        state: 'streaming'
      }]
    }])
  })
})

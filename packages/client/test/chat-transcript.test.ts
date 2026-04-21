import { describe, expect, it } from 'vitest'
import type { Thread } from '../shared/generated/codex-app-server/v2/Thread'
import type { Turn } from '../shared/generated/codex-app-server/v2/Turn'
import {
  asAgentMessageItem,
  findLatestCompletedPlanTurnId,
  findLatestPlanTurnId,
  itemToMessages,
  threadToMessages,
  replaceStreamingMessage,
  upsertStreamingMessage,
  type ChatMessage
} from '../shared/codex-chat'
import { mergeThreadSummary, renameThreadSummary } from '../app/composables/useThreadSummaries'
import { resolveChatMessagesStatus } from '../app/utils/chat-messages-status'

const makeTurn = (input: Pick<Turn, 'id' | 'items' | 'status' | 'error'> & Partial<Pick<Turn, 'startedAt' | 'completedAt' | 'durationMs'>>): Turn => ({
  id: input.id,
  items: input.items,
  status: input.status,
  error: input.error,
  startedAt: input.startedAt ?? null,
  completedAt: input.completedAt ?? null,
  durationMs: input.durationMs ?? null
})

const makeThread = (input: Pick<Thread, 'id' | 'preview' | 'cwd' | 'createdAt' | 'updatedAt' | 'name' | 'turns'>): Thread => ({
  id: input.id,
  forkedFromId: null,
  preview: input.preview,
  ephemeral: false,
  modelProvider: 'openai',
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
  status: { type: 'idle' },
  path: null,
  cwd: input.cwd,
  cliVersion: '0.0.0-test',
  source: 'appServer',
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: input.name,
  turns: input.turns
})

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

  it('maps plan items to dedicated plan parts and replaces streamed plan content', () => {
    expect(itemToMessages({
      type: 'plan',
      id: 'plan-1',
      text: '## Proposed plan'
    })).toEqual<ChatMessage[]>([{
      id: 'plan-1',
      role: 'assistant',
      parts: [{
        type: 'plan',
        text: '## Proposed plan',
        state: 'done'
      }]
    }])

    const streamedMessages = upsertStreamingMessage([], {
      id: 'plan-1',
      role: 'assistant',
      pending: true,
      parts: [{
        type: 'plan',
        text: '## Partial',
        state: 'streaming'
      }]
    })

    expect(replaceStreamingMessage(streamedMessages, {
      id: 'plan-1',
      role: 'assistant',
      pending: false,
      parts: [{
        type: 'plan',
        text: '## Final plan',
        state: 'done'
      }]
    })).toEqual<ChatMessage[]>([{
      id: 'plan-1',
      role: 'assistant',
      pending: false,
      parts: [{
        type: 'plan',
        text: '## Final plan',
        state: 'done'
      }]
    }])
  })

  it('tracks the latest turn that contains a plan item', () => {
    expect(findLatestPlanTurnId([makeTurn({
      id: 'turn-1',
      status: 'completed',
      error: null,
      items: [asAgentMessageItem({
        id: 'agent-1',
        text: 'hello'
      })]
    }), makeTurn({
      id: 'turn-2',
      status: 'completed',
      error: null,
      items: [{
        type: 'plan',
        id: 'plan-1',
        text: 'first plan'
      }]
    }), makeTurn({
      id: 'turn-3',
      status: 'completed',
      error: null,
      items: [asAgentMessageItem({
        id: 'agent-2',
        text: 'follow-up'
      }), {
        type: 'plan',
        id: 'plan-2',
        text: 'latest plan'
      }]
    })])).toBe('turn-3')

    expect(findLatestPlanTurnId([makeTurn({
      id: 'turn-1',
      status: 'completed',
      error: null,
      items: [asAgentMessageItem({
        id: 'agent-1',
        text: 'hello'
      })]
    })])).toBeNull()
  })

  it('tracks the latest completed turn that contains a plan item', () => {
    expect(findLatestCompletedPlanTurnId([makeTurn({
      id: 'turn-1',
      status: 'completed',
      error: null,
      items: [{
        type: 'plan',
        id: 'plan-1',
        text: 'first plan'
      }]
    }), makeTurn({
      id: 'turn-2',
      status: 'inProgress',
      error: null,
      items: [{
        type: 'plan',
        id: 'plan-2',
        text: 'still streaming'
      }]
    })])).toBe('turn-1')

    expect(findLatestCompletedPlanTurnId([makeTurn({
      id: 'turn-1',
      status: 'inProgress',
      error: null,
      items: [{
        type: 'plan',
        id: 'plan-1',
        text: 'not done'
      }]
    })])).toBeNull()
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

  it('maps review lifecycle items into a banner plus final assistant output', () => {
    expect(itemToMessages({
      type: 'enteredReviewMode',
      id: 'review-1',
      review: 'Reviewing current changes'
    })).toEqual([{
      id: 'review-1-review-started',
      role: 'system',
      parts: [{
        type: 'data-thread-event',
        data: {
          kind: 'review.started',
          summary: 'Reviewing current changes'
        }
      }]
    }])

    expect(itemToMessages({
      type: 'exitedReviewMode',
      id: 'review-1',
      review: 'Final review output'
    })).toEqual([{
      id: 'review-1-review-completed',
      role: 'system',
      parts: [{
        type: 'data-thread-event',
        data: {
          kind: 'review.completed'
        }
      }]
    }, {
      id: 'review-1-review-output',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Final review output',
        state: 'done'
      }]
    }])
  })

  it('hydrates server-provided image inputs without assuming a local path', () => {
    expect(itemToMessages({
      type: 'userMessage',
      id: 'user-image-1',
      content: [{
        type: 'image',
        url: 'data:image/png;base64,abc123'
      }]
    })).toEqual<ChatMessage[]>([{
      id: 'user-image-1',
      role: 'user',
      parts: [{
        type: 'attachment',
        attachment: {
          kind: 'image',
          name: 'image',
          mediaType: 'image/png',
          url: 'data:image/png;base64,abc123'
        }
      }]
    }])
  })

  it('hides the synthetic review bootstrap user message when hydrating a thread', () => {
    expect(threadToMessages(makeThread({
      id: 'thread-1',
      preview: '',
      cwd: '/tmp',
      createdAt: 0,
      updatedAt: 0,
      name: null,
      turns: [makeTurn({
        id: 'turn-1',
        status: 'completed',
        error: null,
        items: [{
          type: 'userMessage',
          id: 'turn-1',
          content: [{
            type: 'text',
            text: "changes against 'main'",
            text_elements: []
          }]
        }, {
          type: 'enteredReviewMode',
          id: 'turn-1',
          review: "changes against 'main'"
        }, {
          type: 'userMessage',
          id: 'user-2',
          content: [{
            type: 'text',
            text: 'Full review instructions',
            text_elements: []
          }]
        }]
      })]
    }))).toEqual<ChatMessage[]>([{
      id: 'turn-1-review-started',
      role: 'system',
      parts: [{
        type: 'data-thread-event',
        data: {
          kind: 'review.started',
          summary: "changes against 'main'"
        }
      }]
    }, {
      id: 'user-2',
      role: 'user',
      parts: [{
        type: 'text',
        text: 'Full review instructions',
        state: 'done'
      }]
    }])
  })
})

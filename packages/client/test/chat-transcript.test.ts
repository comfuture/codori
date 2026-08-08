import { describe, expect, it } from 'vitest'
import type { Thread } from '../shared/generated/codex-app-server/v2/Thread'
import type { Turn } from '../shared/generated/codex-app-server/v2/Turn'
import {
  ITEM_PART,
  REALTIME_DELEGATION_PART,
  TOOL_GROUP_PART,
  asAgentMessageItem,
  findLatestCompletedPlanTurnId,
  findLatestPlanTurnId,
  groupTranscriptMessages,
  hasAssistantTextMessageWithText,
  hasAssistantTextMessageWithTextInLatestTurn,
  itemToMessages,
  parseRealtimeDelegation,
  removeSyntheticReviewOutputMessages,
  removeSyntheticReviewOutputMessagesInLatestTurn,
  threadToMessages,
  replaceStreamingMessage,
  upsertStreamingMessage,
  type ChatMessage
} from '../shared/codex-chat'
import { mergeThreadSummary, renameThreadSummary } from '../app/composables/useThreadSummaries'
import {
  hasVisibleAssistantOutputAfterLatestUserMessage,
  resolveChatMessagesStatus
} from '../app/utils/chat-messages-status'

const makeTurn = (input: Pick<Turn, 'id' | 'items' | 'status' | 'error'> & Partial<Pick<Turn, 'startedAt' | 'completedAt' | 'durationMs'>>): Turn => ({
  id: input.id,
  items: input.items,
  itemsView: 'full',
  status: input.status,
  error: input.error,
  startedAt: input.startedAt ?? null,
  completedAt: input.completedAt ?? null,
  durationMs: input.durationMs ?? null
})

const makeThread = (input: Pick<Thread, 'id' | 'preview' | 'cwd' | 'createdAt' | 'updatedAt' | 'name' | 'turns'>): Thread => ({
  id: input.id,
  extra: null,
  sessionId: input.id,
  forkedFromId: null,
  parentThreadId: null,
  preview: input.preview,
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  historyMode: 'legacy',
  modelProvider: 'openai',
  createdAt: input.createdAt,
  updatedAt: input.updatedAt,
  recencyAt: input.updatedAt,
  status: { type: 'idle' },
  path: null,
  cwd: input.cwd,
  cliVersion: '0.0.0-test',
  source: 'appServer',
  canAcceptDirectInput: null,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: input.name,
  turns: input.turns
})

describe('chat transcript stability', () => {
  it('maps realtime handoffs to a dedicated system presentation', () => {
    expect(itemToMessages({
      type: 'userMessage',
      id: 'voice-handoff-1',
      clientId: null,
      content: [{
        type: 'text',
        text: [
          '<realtime_delegation>',
          '  <input>Fix &lt;this&gt; &amp; verify it</input>',
          '  <transcript_delta>user: hello\\nassistant: hi</transcript_delta>',
          '</realtime_delegation>'
        ].join('\n'),
        text_elements: []
      }]
    })).toEqual<ChatMessage[]>([{
      id: 'voice-handoff-1',
      role: 'system',
      parts: [{
        type: REALTIME_DELEGATION_PART,
        data: {
          input: 'Fix <this> & verify it',
          transcriptDelta: 'user: hello\\nassistant: hi',
          source: 'handoff'
        }
      }]
    }])
  })

  it('parses transcript-tail and legacy realtime delegation shapes', () => {
    expect(parseRealtimeDelegation([
      '<realtime_delegation>',
      '  <source>transcript_tail_flush</source>',
      '  <input>Continue from voice</input>',
      '  <transcript_delta>user: one</transcript_delta>',
      '</realtime_delegation>'
    ].join('\n'))).toEqual({
      input: 'Continue from voice',
      transcriptDelta: 'user: one',
      source: 'transcript_tail_flush'
    })

    expect(parseRealtimeDelegation(
      '<realtime_delegation>Run tests <transcript_delta>user: Run tests</transcript_delta></realtime_delegation>'
    )).toEqual({
      input: 'Run tests',
      transcriptDelta: 'user: Run tests',
      source: 'handoff'
    })
    expect(parseRealtimeDelegation('Ordinary typed message')).toBeNull()
  })

  it('renders near-miss delegation wrappers as delegations instead of raw markup', () => {
    expect(parseRealtimeDelegation(
      'Heads up: <realtime_delegation><input>Run the tests</input></realtime_delegation> thanks'
    )).toEqual({
      input: 'Run the tests',
      transcriptDelta: null,
      source: 'handoff'
    })

    // An unterminated wrapper is a streaming partial, not ordinary chat text.
    expect(parseRealtimeDelegation('<realtime_delegation><input>Deploy the')).toEqual({
      input: 'Deploy the',
      transcriptDelta: null,
      source: 'handoff',
      parse: 'partial'
    })

    // A body with no usable input keeps the unparsed remainder in the disclosure.
    expect(parseRealtimeDelegation(
      '<realtime_delegation><unknown_field>x</unknown_field></realtime_delegation>'
    )).toEqual({
      input: '',
      transcriptDelta: '<unknown_field>x</unknown_field>',
      source: 'handoff',
      parse: 'partial'
    })

    expect(parseRealtimeDelegation('<realtime_delegation></realtime_delegation>')).toEqual({
      input: '',
      transcriptDelta: null,
      source: 'handoff',
      parse: 'partial'
    })
  })

  it('preserves prose around a delegation wrapper and promotes only pure delegations', () => {
    expect(itemToMessages({
      type: 'userMessage',
      id: 'voice-handoff-2',
      clientId: null,
      content: [{
        type: 'text',
        text: 'Before <realtime_delegation><input>Run tests</input></realtime_delegation> after',
        text_elements: []
      }]
    })).toEqual<ChatMessage[]>([{
      id: 'voice-handoff-2',
      // A surviving text part keeps the message in the user bubble styling.
      role: 'user',
      parts: [{
        type: 'text',
        text: 'Before ',
        state: 'done'
      }, {
        type: REALTIME_DELEGATION_PART,
        data: {
          input: 'Run tests',
          transcriptDelta: null,
          source: 'handoff'
        }
      }, {
        type: 'text',
        text: ' after',
        state: 'done'
      }]
    }])
  })

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

  it('detects visible assistant output only after the latest user message', () => {
    expect(hasVisibleAssistantOutputAfterLatestUserMessage([{
      id: 'assistant-previous',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Previous reply',
        state: 'done'
      }]
    }, {
      id: 'user-current',
      role: 'user',
      pending: true,
      parts: [{
        type: 'text',
        text: 'New request',
        state: 'streaming'
      }]
    }])).toBe(false)

    expect(hasVisibleAssistantOutputAfterLatestUserMessage([{
      id: 'user-current',
      role: 'user',
      pending: true,
      parts: [{
        type: 'text',
        text: 'New request',
        state: 'streaming'
      }]
    }, {
      id: 'assistant-empty',
      role: 'assistant',
      pending: true,
      parts: [{
        type: 'reasoning',
        summary: [],
        content: [],
        state: 'streaming'
      }]
    }])).toBe(false)

    expect(hasVisibleAssistantOutputAfterLatestUserMessage([{
      id: 'user-current',
      role: 'user',
      pending: true,
      parts: [{
        type: 'text',
        text: 'New request',
        state: 'streaming'
      }]
    }, {
      id: 'assistant-current',
      role: 'assistant',
      pending: true,
      parts: [{
        type: 'text',
        text: 'Streaming reply',
        state: 'streaming'
      }]
    }])).toBe(true)
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
      clientId: null,
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

  it('hydrates remote and local audio inputs as playable audio attachments', () => {
    expect(itemToMessages({
      type: 'userMessage',
      id: 'user-audio-1',
      clientId: null,
      content: [{
        type: 'audio',
        url: 'data:audio/mpeg;base64,abc123'
      }, {
        type: 'localAudio',
        path: '/tmp/voice-note.webm'
      }]
    })).toEqual<ChatMessage[]>([{
      id: 'user-audio-1',
      role: 'user',
      parts: [{
        type: 'attachment',
        attachment: {
          kind: 'audio',
          name: 'audio',
          mediaType: 'audio/mpeg',
          url: 'data:audio/mpeg;base64,abc123'
        }
      }, {
        type: 'attachment',
        attachment: {
          kind: 'audio',
          name: 'voice-note.webm',
          mediaType: 'audio/*',
          localPath: '/tmp/voice-note.webm'
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
          clientId: null,
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
          clientId: null,
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

  it('does not duplicate review output when the server also sends an assistant message', () => {
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
          type: 'exitedReviewMode',
          id: 'review-1',
          review: 'Final review output'
        }, asAgentMessageItem({
          id: 'agent-review-1',
          text: 'Final review output'
        })]
      })]
    }))).toEqual<ChatMessage[]>([{
      id: 'review-1-review-completed',
      role: 'system',
      parts: [{
        type: 'data-thread-event',
        data: {
          kind: 'review.completed'
        }
      }]
    }, {
      id: 'agent-review-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Final review output',
        state: 'done'
      }]
    }])
  })

  it('removes synthetic review output once the real assistant review message arrives', () => {
    const syntheticReviewOutput: ChatMessage = {
      id: 'review-1-review-output',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Final review output',
        state: 'done'
      }]
    }
    const realReviewOutput: ChatMessage = {
      id: 'agent-review-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Final review output',
        state: 'done'
      }]
    }

    expect(hasAssistantTextMessageWithText([syntheticReviewOutput], 'Final review output')).toBe(true)
    expect(removeSyntheticReviewOutputMessages([
      syntheticReviewOutput,
      realReviewOutput
    ], 'Final review output')).toEqual([
      realReviewOutput
    ])
  })

  it('scopes live review output dedupe to the latest turn', () => {
    const previousReviewOutput: ChatMessage = {
      id: 'agent-previous',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Looks good',
        state: 'done'
      }]
    }
    const latestUserMessage: ChatMessage = {
      id: 'user-latest',
      role: 'user',
      parts: [{
        type: 'text',
        text: 'Review again',
        state: 'done'
      }]
    }
    const currentReviewOutput: ChatMessage = {
      id: 'agent-current',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Looks good',
        state: 'done'
      }]
    }

    expect(hasAssistantTextMessageWithTextInLatestTurn([
      previousReviewOutput,
      latestUserMessage
    ], 'Looks good')).toBe(false)
    expect(hasAssistantTextMessageWithTextInLatestTurn([
      previousReviewOutput,
      latestUserMessage,
      currentReviewOutput
    ], 'Looks good')).toBe(true)
  })

  it('only removes matching synthetic review output from the latest turn', () => {
    const previousSyntheticReviewOutput: ChatMessage = {
      id: 'review-previous-review-output',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Looks good',
        state: 'done'
      }]
    }
    const latestUserMessage: ChatMessage = {
      id: 'user-latest',
      role: 'user',
      parts: [{
        type: 'text',
        text: 'Review again',
        state: 'done'
      }]
    }
    const currentSyntheticReviewOutput: ChatMessage = {
      id: 'review-current-review-output',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Looks good',
        state: 'done'
      }]
    }

    expect(removeSyntheticReviewOutputMessagesInLatestTurn([
      previousSyntheticReviewOutput,
      latestUserMessage,
      currentSyntheticReviewOutput
    ], 'Looks good')).toEqual([
      previousSyntheticReviewOutput,
      latestUserMessage
    ])
  })

  it('keeps hydrated web-search items pending for in-progress turns', () => {
    expect(threadToMessages(makeThread({
      id: 'thread-1',
      preview: '',
      cwd: '/tmp',
      createdAt: 0,
      updatedAt: 0,
      name: null,
      turns: [makeTurn({
        id: 'turn-1',
        status: 'inProgress',
        error: null,
        items: [{
          type: 'webSearch',
          id: 'search-1',
          query: 'codori',
          action: null,
          results: null
        }]
      }), makeTurn({
        id: 'turn-2',
        status: 'completed',
        error: null,
        items: [{
          type: 'webSearch',
          id: 'search-2',
          query: 'codex app server',
          action: null,
          results: null
        }]
      })]
    }))).toEqual<ChatMessage[]>([{
      id: 'search-1',
      role: 'system',
      pending: true,
      parts: [{
        type: ITEM_PART,
        data: {
          kind: 'web_search',
          item: {
            type: 'webSearch',
            id: 'search-1',
            query: 'codori',
            action: null,
            results: null
          },
          status: 'inProgress'
        }
      }]
    }, {
      id: 'search-2',
      role: 'system',
      pending: false,
      parts: [{
        type: ITEM_PART,
        data: {
          kind: 'web_search',
          item: {
            type: 'webSearch',
            id: 'search-2',
            query: 'codex app server',
            action: null,
            results: null
          },
          status: 'completed'
        }
      }]
    }])
  })

  it('groups consecutive completed tool messages once assistant output follows', () => {
    const command = itemToMessages({
      type: 'commandExecution',
      id: 'cmd-1',
      pluginId: null,
      scriptPath: null,
      command: 'rg groupTranscriptMessages',
      cwd: '/tmp',
      processId: null,
      source: 'agent',
      status: 'completed',
      commandActions: [],
      aggregatedOutput: 'packages/client/shared/codex-chat.ts',
      exitCode: 0,
      durationMs: 42
    })
    const search = itemToMessages({
      type: 'webSearch',
      id: 'search-1',
      query: 'openai codex tool grouping',
      action: null,
      results: null
    })
    const assistant: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Done',
        state: 'done'
      }]
    }

    const grouped = groupTranscriptMessages([...command, ...search, assistant])

    expect(grouped).toHaveLength(2)
    expect(grouped[0]?.id).toBe('tool-group:2:cmd-1:search-1')
    expect(grouped[0]?.role).toBe('system')
    expect(grouped[0]?.parts[0]).toMatchObject({
      type: TOOL_GROUP_PART,
      data: {
        summary: '2 tool calls',
        details: '1 command, 1 web search',
        messages: [...command, ...search]
      }
    })
    expect(grouped[1]).toBe(assistant)
  })

  it('keeps context compaction separate from adjacent grouped tool items', () => {
    const compaction = itemToMessages({
      type: 'contextCompaction',
      id: 'compact-1'
    })
    const command = itemToMessages({
      type: 'commandExecution',
      id: 'cmd-1',
      pluginId: null,
      scriptPath: null,
      command: 'pnpm test',
      cwd: '/tmp',
      processId: null,
      source: 'agent',
      status: 'completed',
      commandActions: [],
      aggregatedOutput: 'Tests passed',
      exitCode: 0,
      durationMs: 42
    })
    const search = itemToMessages({
      type: 'webSearch',
      id: 'search-1',
      query: 'openai codex compaction',
      action: null,
      results: null
    })
    const assistant: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Done',
        state: 'done'
      }]
    }

    const grouped = groupTranscriptMessages([...compaction, ...command, ...search, assistant])

    expect(grouped).toHaveLength(3)
    expect(grouped[0]).toEqual(compaction[0])
    expect(grouped[1]?.parts[0]).toMatchObject({
      type: TOOL_GROUP_PART,
      data: {
        summary: '2 tool calls',
        details: '1 command, 1 web search',
        messages: [...command, ...search]
      }
    })
    expect(grouped[2]).toBe(assistant)
  })

  it('keeps the active streaming tool tail ungrouped', () => {
    const running = itemToMessages({
      type: 'mcpToolCall',
      id: 'mcp-1',
      server: 'filesystem',
      tool: 'read_file',
      arguments: { path: '/tmp/demo.txt' },
      appContext: null,
      pluginId: null,
      readOnlyHint: null,
      result: null,
      error: null,
      status: 'inProgress',
      durationMs: null
    })
    const completed = itemToMessages({
      type: 'webSearch',
      id: 'search-1',
      query: 'codori',
      action: null,
      results: null
    })
    const assistant: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{
        type: 'reasoning',
        summary: ['Checking'],
        content: [],
        state: 'done'
      }]
    }

    expect(groupTranscriptMessages([...running, ...completed, assistant])).toEqual([
      ...running,
      ...completed,
      assistant
    ])
  })

  it('keeps failed and declined tool items out of grouped cards', () => {
    const failedCommand = itemToMessages({
      type: 'commandExecution',
      id: 'cmd-failed',
      pluginId: null,
      scriptPath: null,
      command: 'pnpm test',
      cwd: '/tmp',
      processId: null,
      source: 'agent',
      status: 'failed',
      commandActions: [],
      aggregatedOutput: 'Tests failed',
      exitCode: 1,
      durationMs: 30
    })
    const declinedEdit = itemToMessages({
      type: 'fileChange',
      id: 'edit-declined',
      changes: [],
      status: 'declined'
    })
    const assistant: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'I found a failure.',
        state: 'done'
      }]
    }

    expect(groupTranscriptMessages([
      ...failedCommand,
      ...declinedEdit,
      assistant
    ])).toEqual([
      ...failedCommand,
      ...declinedEdit,
      assistant
    ])
  })

  it('does not group single tool items or tool runs before non-assistant boundaries', () => {
    const singleTool = itemToMessages({
      type: 'contextCompaction',
      id: 'compact-1'
    })
    const user: ChatMessage = {
      id: 'user-1',
      role: 'user',
      parts: [{
        type: 'text',
        text: 'Next request',
        state: 'done'
      }]
    }
    const assistant: ChatMessage = {
      id: 'assistant-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Done',
        state: 'done'
      }]
    }

    expect(groupTranscriptMessages([...singleTool, assistant])).toEqual([
      ...singleTool,
      assistant
    ])
    expect(groupTranscriptMessages([
      ...itemToMessages({
        type: 'webSearch',
        id: 'search-1',
        query: 'codori',
        action: null,
        results: null
      }),
      ...itemToMessages({
        type: 'webSearch',
        id: 'search-2',
        query: 'openai codex',
        action: null,
        results: null
      }),
      user
    ])).toEqual([
      ...itemToMessages({
        type: 'webSearch',
        id: 'search-1',
        query: 'codori',
        action: null,
        results: null
      }),
      ...itemToMessages({
        type: 'webSearch',
        id: 'search-2',
        query: 'openai codex',
        action: null,
        results: null
      }),
      user
    ])
  })

  it('groups completed tools across display-only review completion events', () => {
    const command = itemToMessages({
      type: 'commandExecution',
      id: 'cmd-1',
      pluginId: null,
      scriptPath: null,
      command: 'pnpm test',
      cwd: '/tmp',
      processId: null,
      source: 'agent',
      status: 'completed',
      commandActions: [],
      aggregatedOutput: 'Tests passed',
      exitCode: 0,
      durationMs: 50
    })
    const edit = itemToMessages({
      type: 'fileChange',
      id: 'edit-1',
      changes: [{
        path: 'packages/client/shared/codex-chat.ts',
        kind: {
          type: 'update',
          move_path: null
        },
        diff: ''
      }],
      status: 'completed'
    })
    const reviewCompleted = itemToMessages({
      type: 'exitedReviewMode',
      id: 'review-1',
      review: 'Final review output'
    })

    const grouped = groupTranscriptMessages([
      ...command,
      ...edit,
      ...reviewCompleted
    ])

    expect(grouped).toHaveLength(3)
    expect(grouped[0]?.parts[0]).toMatchObject({
      type: TOOL_GROUP_PART,
      data: {
        summary: '2 tool calls',
        details: '1 command, 1 edit',
        messages: [...command, ...edit]
      }
    })
    expect(grouped[1]).toEqual(reviewCompleted[0])
    expect(grouped[2]).toEqual(reviewCompleted[1])
  })
})

import { describe, expect, it } from 'vitest'
import {
  reconcileOptimisticUserMessage,
  removePendingUserMessageId,
  resolvePromptSubmitStatus,
  resolveTurnSubmissionMethod,
  shouldIgnoreNotificationAfterInterrupt
} from '../app/utils/chat-turn-engagement'
import { ITEM_PART, isSubagentActiveStatus, itemToMessages } from '../shared/codex-chat'
import {
  buildTurnStartInput,
  resolveAttachmentPreviewUrl,
  resolveAttachmentUploadUrl,
  validateAttachmentSelection
} from '../shared/chat-attachments'
import {
  encodeProjectIdSegment,
  normalizeProjectIdParam,
  projectStatusMeta,
  toProjectRoute,
  toProjectThreadRoute
} from '../shared/codori'
import { resolveApiUrl, resolveWsBase, shouldUseServerProxy } from '../shared/network'

describe('client package', () => {
  it('normalizes project routes and thread routes', () => {
    expect(normalizeProjectIdParam(['team', 'api'])).toBe('team/api')
    expect(toProjectRoute('team/api')).toBe('/projects/team/api')
    expect(toProjectThreadRoute('team/api', 'thread 1')).toBe('/projects/team/api/threads/thread%201')
    expect(encodeProjectIdSegment('team/api')).toBe('team%2Fapi')
  })

  it('returns status badge metadata', () => {
    expect(projectStatusMeta('running')).toEqual({
      color: 'success',
      label: 'Running'
    })
  })

  it('resolves standalone proxy mode and websocket protocol correctly', () => {
    expect(shouldUseServerProxy('https://codori.example.com')).toBe(true)
    expect(shouldUseServerProxy('')).toBe(false)
    expect(resolveApiUrl('/projects', 'http://127.0.0.1:4310')).toBe('http://127.0.0.1:4310/api/projects')
    expect(resolveWsBase('', 'HTTPS://codori.example.com')).toBe('wss://codori.example.com')
    expect(resolveWsBase('', 'http://127.0.0.1:4310')).toBe('ws://127.0.0.1:4310')
  })

  it('maps agent thread items into chat messages', () => {
    expect(itemToMessages({
      type: 'agentMessage',
      id: 'agent-1',
      text: 'Working on it'
    })).toEqual([{
      id: 'agent-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Working on it',
        state: 'done'
      }]
    }])
  })

  it('builds turn input for text with image attachments', () => {
    expect(buildTurnStartInput('Investigate this UI bug', [
      { path: '/tmp/screenshot.png' }
    ])).toEqual([
      {
        type: 'text',
        text: 'Investigate this UI bug',
        text_elements: []
      },
      {
        type: 'localImage',
        path: '/tmp/screenshot.png'
      }
    ])
    expect(buildTurnStartInput('', [
      { path: '/tmp/screenshot.png' }
    ])).toEqual([{
      type: 'localImage',
      path: '/tmp/screenshot.png'
    }])
  })

  it('routes attachment requests through the Nuxt proxy in standalone client mode', () => {
    expect(resolveAttachmentUploadUrl({
      projectId: 'team/api',
      configuredBase: 'https://codori.example.com'
    })).toBe('/api/codori/projects/team%2Fapi/attachments')

    expect(resolveAttachmentPreviewUrl({
      projectId: 'team/api',
      path: '/tmp/screenshot.png',
      configuredBase: 'https://codori.example.com'
    })).toBe('/api/codori/projects/team%2Fapi/attachments/file?path=%2Ftmp%2Fscreenshot.png')
  })

  it('keeps direct attachment requests when bundled with the codori server', () => {
    expect(resolveAttachmentUploadUrl({
      projectId: 'team/api',
      configuredBase: ''
    })).toBe('http://127.0.0.1:4310/api/projects/team%2Fapi/attachments')

    expect(resolveAttachmentPreviewUrl({
      projectId: 'team/api',
      path: '/tmp/screenshot.png',
      configuredBase: ''
    })).toBe('http://127.0.0.1:4310/api/projects/team%2Fapi/attachments/file?path=%2Ftmp%2Fscreenshot.png')
  })

  it('validates attachment selections before submit', () => {
    const result = validateAttachmentSelection([
      {
        name: 'diagram.png',
        size: 10,
        type: 'image/png'
      },
      {
        name: 'notes.txt',
        size: 10,
        type: 'text/plain'
      }
    ], 0)

    expect(result.accepted).toEqual([{
      name: 'diagram.png',
      size: 10,
      type: 'image/png'
    }])
    expect(result.issues).toEqual([{
      code: 'unsupportedType',
      fileName: 'notes.txt',
      message: 'Only image attachments are currently supported.'
    }])
  })

  it('renders local image user inputs as attachment parts', () => {
    expect(itemToMessages({
      type: 'userMessage',
      id: 'user-1',
      content: [{
        type: 'text',
        text: 'Please inspect this screenshot.',
        text_elements: []
      }, {
        type: 'localImage',
        path: '/tmp/screenshot.png'
      }]
    })).toEqual([{
      id: 'user-1',
      role: 'user',
      parts: [{
        type: 'text',
        text: 'Please inspect this screenshot.',
        state: 'done'
      }, {
        type: 'attachment',
        attachment: {
          kind: 'image',
          name: 'screenshot.png',
          mediaType: 'image/*',
          localPath: '/tmp/screenshot.png'
        }
      }]
    }])
  })

  it('maps tool items into structured message parts', () => {
    expect(itemToMessages({
      type: 'mcpToolCall',
      id: 'tool-1',
      server: 'filesystem',
      tool: 'read_file',
      arguments: { path: '/tmp/demo.txt' },
      result: null,
      error: null,
      status: 'inProgress'
    })).toEqual([{
      id: 'tool-1',
      role: 'system',
      pending: true,
      parts: [{
        type: ITEM_PART,
        data: {
          kind: 'mcp_tool_call',
          item: {
            type: 'mcpToolCall',
            id: 'tool-1',
            server: 'filesystem',
            tool: 'read_file',
            arguments: { path: '/tmp/demo.txt' },
            result: null,
            error: null,
            status: 'inProgress'
          }
        }
      }]
    }])
  })

  it('maps subagent activity items into structured message parts', () => {
    expect(itemToMessages({
      type: 'collabAgentToolCall',
      id: 'sub-1',
      tool: 'spawnAgent',
      status: 'inProgress',
      senderThreadId: 'parent-thread',
      receiverThreadIds: ['child-thread'],
      prompt: 'Inspect the API surface.',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'medium',
      agentsStates: {
        'child-thread': {
          status: 'running',
          message: 'Scanning files'
        }
      }
    })).toEqual([{
      id: 'sub-1',
      role: 'system',
      pending: true,
      parts: [{
        type: ITEM_PART,
        data: {
          kind: 'subagent_activity',
          item: {
            type: 'collabAgentToolCall',
            id: 'sub-1',
            tool: 'spawnAgent',
            status: 'inProgress',
            senderThreadId: 'parent-thread',
            receiverThreadIds: ['child-thread'],
            prompt: 'Inspect the API surface.',
            model: 'gpt-5.4-mini',
            reasoningEffort: 'medium',
            agentsStates: [{
              threadId: 'child-thread',
              status: 'running',
              message: 'Scanning files'
            }]
          }
        }
      }]
    }])
  })

  it('treats pending and running subagents as active', () => {
    expect(isSubagentActiveStatus(null)).toBe(true)
    expect(isSubagentActiveStatus('pendingInit')).toBe(true)
    expect(isSubagentActiveStatus('running')).toBe(true)
    expect(isSubagentActiveStatus('completed')).toBe(false)
  })

  it('routes submissions to turn start or same-turn steering', () => {
    expect(resolveTurnSubmissionMethod(false)).toBe('turn/start')
    expect(resolveTurnSubmissionMethod(true)).toBe('turn/steer')
  })

  it('keeps the prompt submit button in send mode while a draft exists', () => {
    expect(resolvePromptSubmitStatus({
      status: 'streaming',
      hasDraftContent: true
    })).toBe('ready')

    expect(resolvePromptSubmitStatus({
      status: 'submitted',
      hasDraftContent: false
    })).toBe('submitted')
  })

  it('reconciles a pending optimistic user message in place', () => {
    expect(reconcileOptimisticUserMessage([{
      id: 'local-user-1',
      role: 'user',
      pending: true,
      parts: [{
        type: 'text',
        text: 'Follow this direction instead.',
        state: 'done'
      }]
    }, {
      id: 'agent-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Working on it',
        state: 'streaming'
      }]
    }], 'local-user-1', {
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Follow this direction instead.',
        state: 'done'
      }]
    })).toEqual([{
      id: 'user-1',
      role: 'user',
      pending: false,
      parts: [{
        type: 'text',
        text: 'Follow this direction instead.',
        state: 'done'
      }]
    }, {
      id: 'agent-1',
      role: 'assistant',
      parts: [{
        type: 'text',
        text: 'Working on it',
        state: 'streaming'
      }]
    }])
  })

  it('removes only the failed optimistic message from the pending queue', () => {
    expect(removePendingUserMessageId(['local-user-1', 'local-user-2'], 'local-user-1')).toEqual(['local-user-2'])
  })

  it('ignores further streaming deltas after interruption is acknowledged', () => {
    expect(shouldIgnoreNotificationAfterInterrupt('item/agentMessage/delta')).toBe(true)
    expect(shouldIgnoreNotificationAfterInterrupt('item/started')).toBe(true)
    expect(shouldIgnoreNotificationAfterInterrupt('item/completed')).toBe(false)
    expect(shouldIgnoreNotificationAfterInterrupt('turn/completed')).toBe(false)
  })
})

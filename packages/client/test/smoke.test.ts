import { describe, expect, it } from 'vitest'
import { ITEM_PART, isSubagentActiveStatus, itemToMessages } from '../shared/codex-chat'
import {
  buildTurnStartInput,
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
})

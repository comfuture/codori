import { describe, expect, it } from 'vitest'
import { CODORI_ITEM_PART, itemToMessages } from '../shared/codex-chat.js'
import {
  encodeProjectIdSegment,
  normalizeProjectIdParam,
  projectStatusMeta,
  toProjectRoute,
  toProjectThreadRoute
} from '../shared/codori.js'

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
        type: CODORI_ITEM_PART,
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
})

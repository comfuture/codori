import { describe, expect, it } from 'vitest'
import { itemToMessages } from '../shared/codex-chat.js'
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
      text: 'Working on it'
    }])
  })
})

import { describe, expect, it } from 'vitest'
import {
  areThreadWorkspacePathsEqual,
  extractThreadDiscoveryHints,
  normalizeThreadRunningState
} from '../app/utils/codex-thread-discovery'
import type { CodexRpcNotification } from '../shared/codex-rpc'

const notification = (value: unknown) => value as CodexRpcNotification

describe('Codex thread discovery compatibility', () => {
  it('normalizes workspace path separators, trailing slashes, and Windows casing', () => {
    expect(areThreadWorkspacePathsEqual('/workspace/project/', '/workspace/project')).toBe(true)
    expect(areThreadWorkspacePathsEqual('C:\\Work\\Project', 'c:/work/project/')).toBe(true)
    expect(areThreadWorkspacePathsEqual('/workspace/one', '/workspace/two')).toBe(false)
  })

  it('accepts an identified thread/started payload even when newer fields are absent', () => {
    const thread = {
      id: 'thread-child',
      cwd: '/workspace',
      parentThreadId: 'thread-parent'
    }

    expect(extractThreadDiscoveryHints(notification({
      method: 'thread/started',
      params: { thread }
    }))).toEqual({
      thread,
      statusUpdate: null,
      referencedThreadIds: []
    })

    expect(extractThreadDiscoveryHints(notification({
      method: 'thread/started',
      params: { thread: { cwd: '/workspace' } }
    })).thread).toBeNull()
  })

  it('uses an embedded thread/started status without treating non-active types as running', () => {
    expect(normalizeThreadRunningState(notification({
      method: 'thread/started',
      params: {
        thread: {
          id: 'thread-active',
          status: { type: 'active', activeFlags: [] }
        }
      }
    }))).toEqual({
      threadId: 'thread-active',
      running: true,
      source: 'threadStatus'
    })

    expect(normalizeThreadRunningState(notification({
      method: 'thread/started',
      params: {
        thread: {
          id: 'thread-idle',
          status: { type: 'idle' }
        }
      }
    }))).toEqual({
      threadId: 'thread-idle',
      running: false,
      source: 'threadStatus'
    })
  })

  it('normalizes current thread statuses and treats only active as running', () => {
    for (const type of ['idle', 'notLoaded', 'systemError'] as const) {
      const input = notification({
        method: 'thread/status/changed',
        params: { threadId: 'thread-child', status: { type } }
      })

      expect(extractThreadDiscoveryHints(input).statusUpdate).toEqual({
        threadId: 'thread-child',
        status: { type }
      })
      expect(normalizeThreadRunningState(input)).toEqual({
        threadId: 'thread-child',
        running: false,
        source: 'threadStatus'
      })
    }

    const active = notification({
      method: 'thread/status/changed',
      params: {
        threadId: 'thread-child',
        status: {
          type: 'active',
          activeFlags: ['waitingOnApproval', 'futureFlag']
        }
      }
    })

    expect(extractThreadDiscoveryHints(active).statusUpdate).toEqual({
      threadId: 'thread-child',
      status: { type: 'active', activeFlags: ['waitingOnApproval'] }
    })
    expect(normalizeThreadRunningState(active)).toEqual({
      threadId: 'thread-child',
      running: true,
      source: 'threadStatus'
    })

    const futureStatus = notification({
      method: 'thread/status/changed',
      params: {
        threadId: 'future-thread',
        status: { type: 'futureStatus', busy: true }
      }
    })
    expect(extractThreadDiscoveryHints(futureStatus).statusUpdate).toEqual({
      threadId: 'future-thread',
      status: null
    })
    expect(normalizeThreadRunningState(futureStatus)).toBeNull()
  })

  it('uses turn lifecycle notifications only as explicitly labeled fallbacks', () => {
    expect(normalizeThreadRunningState(notification({
      method: 'turn/started',
      params: { threadId: 'thread-child', turn: { id: 'turn-1' } }
    }))).toEqual({
      threadId: 'thread-child',
      running: true,
      source: 'turnLifecycleFallback'
    })

    for (const method of ['turn/completed', 'turn/failed'] as const) {
      expect(normalizeThreadRunningState(notification({
        method,
        params: { threadId: 'thread-child' }
      }))).toEqual({
        threadId: 'thread-child',
        running: false,
        source: 'turnLifecycleFallback'
      })
    }
  })

  it.each(['started', 'interacted', 'interrupted'])(
    'extracts a thread reference from subAgentActivity %s without inferring running state',
    (kind) => {
      const input = notification({
        method: 'item/completed',
        params: {
          threadId: 'thread-parent',
          turnId: 'turn-parent',
          item: {
            type: 'subAgentActivity',
            id: `activity-${kind}`,
            kind,
            agentThreadId: 'thread-child',
            agentPath: '/root/worker'
          }
        }
      })

      expect(extractThreadDiscoveryHints(input).referencedThreadIds).toEqual(['thread-child'])
      expect(normalizeThreadRunningState(input)).toBeNull()
    }
  )

  it.each(['spawnAgent', 'sendInput', 'resumeAgent'])(
    'extracts deduplicated receiver ids from legacy %s activity',
    (tool) => {
      const input = notification({
        method: 'item/completed',
        params: {
          threadId: 'thread-parent',
          turnId: 'turn-parent',
          item: {
            type: 'collabAgentToolCall',
            id: `collab-${tool}`,
            tool,
            receiverThreadIds: ['thread-child', '', 'thread-child', 'thread-peer']
          }
        }
      })

      expect(extractThreadDiscoveryHints(input).referencedThreadIds).toEqual([
        'thread-child',
        'thread-peer'
      ])
      expect(normalizeThreadRunningState(input)).toBeNull()
    }
  )

  it('ignores unrelated or malformed collaboration items', () => {
    expect(extractThreadDiscoveryHints(notification({
      method: 'item/completed',
      params: {
        item: {
          type: 'collabAgentToolCall',
          tool: 'wait',
          receiverThreadIds: ['thread-child']
        }
      }
    })).referencedThreadIds).toEqual([])

    expect(extractThreadDiscoveryHints(notification({
      method: 'item/completed',
      params: {
        item: {
          type: 'subAgentActivity',
          kind: 'futureActivity',
          agentThreadId: 'thread-child'
        }
      }
    })).referencedThreadIds).toEqual([])
  })
})

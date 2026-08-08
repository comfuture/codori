import { describe, expect, it } from 'vitest'

import type { CodexRpcNotification } from '../shared/codex-rpc'
import type { ThreadItem } from '../shared/generated/codex-app-server/v2/ThreadItem'
import {
  createToolItemStore,
  normalizeToolItemPresentations,
  reduceToolItemNotification
} from '../shared/tool-items'

const rpcNotification = (
  method: CodexRpcNotification['method'],
  params: Record<string, unknown>
) => ({ method, params }) as CodexRpcNotification

const command = (status: 'inProgress' | 'completed'): ThreadItem => ({
  type: 'commandExecution',
  id: 'command-1',
  pluginId: null,
  scriptPath: null,
  command: 'pnpm test',
  cwd: '/workspace',
  processId: 'process-1',
  source: 'agent',
  status,
  commandActions: [],
  aggregatedOutput: status === 'completed' ? 'one\ntwo' : '',
  exitCode: status === 'completed' ? 0 : null,
  durationMs: status === 'completed' ? 100 : null
})

describe('shared tool notification reducer', () => {
  it('reconciles command streaming and authoritative completion with a stable id', () => {
    let store = createToolItemStore()
    store = reduceToolItemNotification(store, rpcNotification('item/started', {
      threadId: 'thread-1',
      item: command('inProgress')
    }), { threadId: 'thread-1' })
    store = reduceToolItemNotification(store, rpcNotification('item/commandExecution/outputDelta', {
      threadId: 'thread-1',
      itemId: 'command-1',
      delta: 'one\n'
    }), { threadId: 'thread-1' })
    store = reduceToolItemNotification(store, rpcNotification('item/completed', {
      threadId: 'thread-1',
      item: command('completed')
    }), { threadId: 'thread-1' })

    expect(normalizeToolItemPresentations(store)).toEqual([expect.objectContaining({
      id: 'command-1',
      kind: 'command_execution',
      title: 'pnpm test',
      status: 'completed',
      processId: 'process-1',
      cwd: '/workspace',
      exitCode: 0,
      text: 'Output\none\ntwo\n\nExit\nExit code 0'
    })])
  })

  it('covers file, MCP, dynamic-tool, and web-search presentations from one fixture stream', () => {
    const items: ThreadItem[] = [
      {
        type: 'fileChange',
        id: 'file-1',
        changes: [{
          path: 'src/app.ts',
          kind: { type: 'update', move_path: null },
          diff: '+next'
        }],
        status: 'completed'
      },
      {
        type: 'mcpToolCall',
        id: 'mcp-1',
        server: 'server',
        tool: 'read',
        status: 'completed',
        arguments: { path: 'README.md' },
        appContext: null,
        pluginId: null,
        readOnlyHint: null,
        result: null,
        error: null,
        durationMs: 10
      },
      {
        type: 'dynamicToolCall',
        id: 'dynamic-1',
        namespace: 'browser',
        tool: 'open',
        arguments: null,
        status: 'completed',
        contentItems: [{ type: 'inputText', text: 'open page' }],
        success: true,
        durationMs: 10
      },
      {
        type: 'webSearch',
        id: 'web-1',
        query: 'WebXR',
        action: null,
        results: null
      }
    ]
    let store = createToolItemStore()
    for (const item of items) {
      store = reduceToolItemNotification(store, rpcNotification('item/completed', {
        threadId: 'thread-1',
        item
      }))
    }

    expect(normalizeToolItemPresentations(store).map(item => [
      item.id,
      item.kind,
      item.status
    ])).toEqual([
      ['file-1', 'file_change', 'completed'],
      ['mcp-1', 'mcp_tool_call', 'completed'],
      ['dynamic-1', 'dynamic_tool_call', 'completed'],
      ['web-1', 'web_search', 'completed']
    ])
  })

  it('streams structured file patches before completion', () => {
    let store = reduceToolItemNotification(
      createToolItemStore(),
      rpcNotification('item/started', {
        threadId: 'thread-1',
        item: {
          type: 'fileChange',
          id: 'file-1',
          changes: [],
          status: 'inProgress'
        }
      })
    )
    store = reduceToolItemNotification(
      store,
      rpcNotification('item/fileChange/patchUpdated', {
        threadId: 'thread-1',
        itemId: 'file-1',
        changes: [{
          path: 'src/app.ts',
          kind: { type: 'update', move_path: null },
          diff: '@@ -1 +1 @@\n-old\n+new'
        }]
      })
    )

    expect(normalizeToolItemPresentations(store)[0]).toMatchObject({
      id: 'file-1',
      title: 'src/app.ts',
      status: 'running',
      fileChanges: [{
        path: 'src/app.ts',
        kind: { type: 'update', move_path: null }
      }]
    })
  })

  it('preserves latest output within a visible bounded tail', () => {
    const store = reduceToolItemNotification(createToolItemStore(), rpcNotification(
      'item/commandExecution/outputDelta',
      {
        threadId: 'thread-1',
        itemId: 'command-1',
        delta: '0123456789'.repeat(20)
      }
    ))
    const [presentation] = normalizeToolItemPresentations(store, {
      maximumCharacters: 64
    })

    expect(presentation).toMatchObject({
      id: 'command-1',
      truncated: true
    })
    expect(presentation?.text.endsWith('6789')).toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'

import {
  backgroundTerminalKey,
  listAllThreadBackgroundTerminals,
  reconcileBackgroundTerminals,
  type BackgroundTerminalRpcClient
} from '../shared/background-terminals'
import type { ThreadBackgroundTerminal } from '../shared/generated/codex-app-server/v2/ThreadBackgroundTerminal'

const terminal = (
  itemId: string,
  processId: string,
  command = 'pnpm dev'
): ThreadBackgroundTerminal => ({
  itemId,
  processId,
  command,
  cwd: '/workspace',
  osPid: 123,
  cpuPercent: 1.5,
  rssKb: 2048n
})

describe('background terminal listing', () => {
  it('collects every page before returning authoritative state', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        data: [terminal('item-1', 'process-1')],
        nextCursor: 'page-2'
      })
      .mockResolvedValueOnce({
        data: [terminal('item-2', 'process-2')],
        nextCursor: null
      })
    const result = await listAllThreadBackgroundTerminals(
      { request } as BackgroundTerminalRpcClient,
      'thread-1',
      { pageSize: 1 }
    )

    expect(result.map(backgroundTerminalKey)).toEqual([
      'item-1\u0000process-1',
      'item-2\u0000process-2'
    ])
    expect(request).toHaveBeenNthCalledWith(2, 'thread/backgroundTerminals/list', {
      threadId: 'thread-1',
      limit: 1,
      cursor: 'page-2'
    })
  })

  it('fails closed on a repeated pagination cursor', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({
        data: [],
        nextCursor: 'same'
      })
    } as unknown as BackgroundTerminalRpcClient

    await expect(listAllThreadBackgroundTerminals(client, 'thread-1'))
      .rejects.toThrow('repeated cursor')
  })
})

describe('background terminal reconciliation', () => {
  it('keys by item and process, preserves first-seen time, and removes only absent sessions', () => {
    const initial = reconcileBackgroundTerminals([], [
      terminal('item-1', 'process'),
      terminal('item-2', 'process')
    ], 100)
    const next = reconcileBackgroundTerminals(initial.terminals, [
      { ...terminal('item-2', 'process'), cpuPercent: 3 }
    ], 200)

    expect(initial.added).toHaveLength(2)
    expect(next.terminals).toEqual([expect.objectContaining({
      source: 'agent-background',
      itemId: 'item-2',
      processId: 'process',
      cpuPercent: 3,
      rssKb: '2048',
      firstSeenAt: 100,
      lastSeenAt: 200
    })])
    expect(next.removed.map(removed => removed.itemId)).toEqual(['item-1'])
  })
})

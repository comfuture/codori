import { describe, expect, it, vi } from 'vitest'
import type {
  CodexRpcConnectionState,
  CodexRpcClient
} from '@codori/client/shared/codex-rpc'
import type { Thread } from '@codori/client/shared/generated/codex-app-server/v2'
import { WorkspaceRuntime } from '../src/workspace-runtime'

describe('immersive workspace runtime', () => {
  it('resumes the thread before reading authoritative background terminals', async () => {
    const threadId = 'thread-103'
    const thread = {
      id: threadId,
      ephemeral: false,
      turns: []
    } as unknown as Thread
    const requests: string[] = []
    const close = vi.fn()
    const client = {
      connect: vi.fn(async () => {}),
      close,
      subscribe: vi.fn(() => () => {}),
      subscribeConnectionState: vi.fn((
        listener: (state: CodexRpcConnectionState) => void
      ) => {
        listener('connected')
        return () => {}
      }),
      request: vi.fn(async (method: string) => {
        requests.push(method)
        if (method === 'thread/resume') {
          return { thread }
        }
        if (method === 'thread/read') {
          return { thread }
        }
        if (method === 'thread/backgroundTerminals/list') {
          return {
            data: [],
            nextCursor: null
          }
        }
        throw new Error(`Unexpected request: ${method}`)
      })
    } as unknown as CodexRpcClient
    let nextTimer = 0
    const setInterval = vi.fn(() => {
      nextTimer += 1
      return nextTimer
    }) as unknown as typeof globalThis.setInterval
    const clearInterval = vi.fn() as unknown as typeof globalThis.clearInterval
    const runtime = new WorkspaceRuntime({
      identity: {
        workspace: {
          kind: 'project',
          id: 'codori'
        },
        threadId
      },
      client,
      now: () => 1_000,
      setInterval,
      clearInterval
    })

    await runtime.start()

    expect(requests).toEqual([
      'thread/resume',
      'thread/read',
      'thread/backgroundTerminals/list'
    ])
    expect(runtime.snapshot()).toMatchObject({
      connection: 'connected',
      thread,
      error: null
    })
    expect(setInterval).toHaveBeenCalledTimes(2)

    await runtime.dispose()
    expect(clearInterval).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledOnce()
  })
})

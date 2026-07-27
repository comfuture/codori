import { describe, expect, it, vi } from 'vitest'
import type {
  CodexRpcNotification,
  CodexRpcConnectionState,
  CodexRpcClient
} from '@codori/client/shared/codex-rpc'
import type {
  Thread,
  ThreadItem
} from '@codori/client/shared/generated/codex-app-server/v2'
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

  it('shows a tool at start, streams deltas, and starts dwell at completion', async () => {
    const threadId = 'thread-103'
    const thread = {
      id: threadId,
      ephemeral: false,
      turns: []
    } as unknown as Thread
    let notificationListener: (
      notification: CodexRpcNotification
    ) => void = () => {}
    let now = 1_000
    const command = (
      status: 'inProgress' | 'completed'
    ): ThreadItem => ({
      type: 'commandExecution',
      id: 'command-1',
      command: 'pnpm test',
      cwd: '/workspace',
      processId: 'process-1',
      source: 'agent',
      status,
      commandActions: [],
      aggregatedOutput: status === 'completed'
        ? 'streaming\ndone'
        : '',
      exitCode: status === 'completed' ? 0 : null,
      durationMs: status === 'completed' ? 1_000 : null
    })
    const client = {
      connect: vi.fn(async () => {}),
      close: vi.fn(),
      subscribe: vi.fn((
        listener: (notification: CodexRpcNotification) => void
      ) => {
        notificationListener = listener
        return () => {}
      }),
      subscribeConnectionState: vi.fn(() => () => {}),
      request: vi.fn(async (method: string) => {
        if (method === 'thread/resume' || method === 'thread/read') {
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
    const runtime = new WorkspaceRuntime({
      identity: {
        workspace: {
          kind: 'project',
          id: 'codori'
        },
        threadId
      },
      client,
      now: () => now,
      setInterval: vi.fn(() => 1) as unknown as typeof globalThis.setInterval,
      clearInterval: vi.fn() as unknown as typeof globalThis.clearInterval
    })
    await runtime.start()

    notificationListener({
      method: 'item/started',
      params: {
        threadId,
        turnId: 'turn-1',
        item: command('inProgress')
      }
    } as CodexRpcNotification)
    expect(runtime.snapshot().panels[0]).toMatchObject({
      id: 'command-1',
      status: 'in-progress',
      phase: 'appearing'
    })

    now = 1_100
    notificationListener({
      method: 'item/commandExecution/outputDelta',
      params: {
        threadId,
        turnId: 'turn-1',
        itemId: 'command-1',
        delta: 'streaming\n'
      }
    } as CodexRpcNotification)
    expect(runtime.snapshot().panels[0]?.retainedText)
      .toContain('streaming')

    now = 2_000
    notificationListener({
      method: 'item/completed',
      params: {
        threadId,
        turnId: 'turn-1',
        item: command('completed')
      }
    } as CodexRpcNotification)
    expect(runtime.snapshot().panels[0]).toMatchObject({
      status: 'completed',
      phase: 'dwelling',
      phaseStartedAt: 2_000
    })

    now = 3_000
    runtime.dismissPanel('command-1')
    expect(runtime.snapshot().panels[0]?.phase).toBe('bursting')

    notificationListener({
      method: 'item/started',
      params: {
        threadId,
        turnId: 'turn-1',
        startedAtMs: now,
        item: {
          type: 'fileChange',
          id: 'file-1',
          changes: [],
          status: 'inProgress'
        }
      }
    } as CodexRpcNotification)
    expect(
      runtime.snapshot().panels.filter(panel =>
        panel.kind === 'file-change'
      )
    ).toHaveLength(0)

    now = 3_100
    notificationListener({
      method: 'item/fileChange/patchUpdated',
      params: {
        threadId,
        turnId: 'turn-1',
        itemId: 'file-1',
        changes: [{
          path: 'src/app.ts',
          kind: { type: 'update', move_path: null },
          diff: '@@ -1 +1 @@\n-old\n+new'
        }]
      }
    } as CodexRpcNotification)
    expect(
      runtime.snapshot().panels.filter(panel =>
        panel.kind === 'file-change'
      )
    ).toEqual([expect.objectContaining({
      id: 'file:src%2Fapp.ts',
      sourceId: 'file-1',
      title: 'src/app.ts',
      text: '',
      fileChange: expect.objectContaining({
        kind: 'update'
      })
    })])

    notificationListener({
      method: 'item/started',
      params: {
        threadId,
        turnId: 'turn-1',
        startedAtMs: now,
        item: {
          type: 'fileChange',
          id: 'file-2',
          changes: [],
          status: 'inProgress'
        }
      }
    } as CodexRpcNotification)
    now = 3_200
    notificationListener({
      method: 'item/fileChange/patchUpdated',
      params: {
        threadId,
        turnId: 'turn-1',
        itemId: 'file-2',
        changes: [{
          path: 'src/app.ts',
          kind: { type: 'update', move_path: null },
          diff: '@@ -1 +1 @@\n-new\n+newer'
        }]
      }
    } as CodexRpcNotification)
    const filePanels = runtime.snapshot().panels.filter(panel =>
      panel.kind === 'file-change'
    )
    expect(filePanels).toHaveLength(1)
    expect(filePanels[0]).toMatchObject({
      id: 'file:src%2Fapp.ts',
      sourceId: 'file-2',
      phase: 'appearing',
      fileTransitionStartedAt: 3_200
    })
    await runtime.dispose()
  })
})

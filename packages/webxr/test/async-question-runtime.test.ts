import { describe, expect, it, vi } from 'vitest'
import type { CodexRpcClient, CodexRpcNotification } from '@codori/client/shared/codex-rpc'
import { WorkspaceRuntime } from '../src/workspace-runtime'
import { asAgentMessageItem } from '@codori/client/shared/codex-chat'
import type { Turn } from '@codori/client/shared/generated/codex-app-server/v2'

const activeTurn = (id: string): Turn => ({
  id, items: [], itemsView: 'full', status: 'inProgress', error: null,
  startedAt: null, completedAt: null, durationMs: null
})

const setup = async () => {
  let notify: (notification: CodexRpcNotification) => void = () => {}
  let now = 1000
  const timers: (() => void)[] = []
  const request = vi.fn(async (method: string, _params?: unknown): Promise<unknown> => {
    void _params
    if (method === 'thread/resume' || method === 'thread/read') return { thread: { id: 'thread', ephemeral: false, turns: [] } }
    if (method === 'thread/backgroundTerminals/list') return { data: [], nextCursor: null }
    if (method === 'account/rateLimits/read') return {}
    if (method === 'turn/start') return { turn: { id: 'new-turn' } }
    if (method === 'turn/steer') return {}
    throw new Error(method)
  })
  const client = {
    connect: async () => {}, close: () => {}, request,
    subscribe: (listener: typeof notify) => { notify = listener; return () => {} },
    subscribeConnectionState: () => () => {}
  } as unknown as CodexRpcClient
  const runtime = new WorkspaceRuntime({
    identity: { workspace: { kind: 'project', id: 'project' }, threadId: 'thread' }, client,
    setInterval: ((callback: () => void) => { timers.push(callback); return timers.length }) as unknown as typeof setInterval,
    clearInterval: (() => {}) as unknown as typeof clearInterval,
    now: () => now
  })
  await runtime.start()
  const question = () => notify({ method: 'item/completed', params: {
    threadId: 'thread', turnId: 'turn', completedAtMs: 1000, item: asAgentMessageItem({
      id: 'question', text: '', questions: [{ title: 'Choose', options: ['A', 'B'] }]
    })
  } })
  return { runtime, notify, request, timers, question, advance: (milliseconds: number) => { now += milliseconds } }
}

describe('immersive async answer transport', () => {
  it('does not expire on panel timers or later turn starts and steers only the owning thread', async () => {
    const { runtime, notify, request, timers, question, advance } = await setup()
    question()
    advance(10 * 60 * 1000)
    timers.forEach(timer => timer())
    notify({ method: 'turn/started', params: { threadId: 'thread', turn: activeTurn('later-one') } })
    notify({ method: 'turn/started', params: { threadId: 'thread', turn: activeTurn('later-two') } })
    expect(runtime.snapshot().asyncQuestions.currentId).toBe('question')
    await runtime.handleAsyncQuestionAction({ type: 'send', index: 0, text: 'B' })
    expect(request).toHaveBeenCalledWith('turn/steer', expect.objectContaining({
      threadId: 'thread', expectedTurnId: 'later-two',
      input: [{ type: 'text', text: 'Choose\nB', text_elements: [] }]
    }))
    expect(runtime.snapshot().asyncQuestions.currentId).toBeNull()
    await runtime.dispose()
  })

  it('retains custom drafts after failure and starts an ordinary user turn when idle', async () => {
    const { runtime, request, question } = await setup()
    question()
    await runtime.handleAsyncQuestionAction({ type: 'answer', index: 0, text: 'Custom draft' })
    const implementation = request.getMockImplementation()!
    request.mockImplementationOnce(async () => { throw new Error('Offline') })
    await runtime.handleAsyncQuestionAction({ type: 'send', index: 0 })
    expect(runtime.snapshot().asyncQuestions).toMatchObject({ currentId: 'question', error: 'Offline' })
    expect(runtime.snapshot().asyncQuestions.history[0]?.answers).toEqual(['Custom draft'])
    request.mockImplementation(implementation)
    await runtime.handleAsyncQuestionAction({ type: 'send', index: 0 })
    expect(request).toHaveBeenCalledWith('turn/start', expect.objectContaining({
      threadId: 'thread', input: [{ type: 'text', text: 'Choose\nCustom draft', text_elements: [] }]
    }))
    await runtime.dispose()
  })

  it('retries a stale active turn as an ordinary new turn with the same user message identity', async () => {
    const { runtime, request, notify, question } = await setup()
    question()
    notify({ method: 'turn/started', params: { threadId: 'thread', turn: activeTurn('finished-turn') } })
    const implementation = request.getMockImplementation()!
    request.mockImplementation(async (method, params) => {
      if (method === 'turn/steer') throw new Error('No active turn to steer')
      return implementation(method, params)
    })
    await runtime.handleAsyncQuestionAction({ type: 'send', index: 0, text: 'B' })
    const steer = request.mock.calls.find(([method]) => method === 'turn/steer')?.[1] as { clientUserMessageId: string }
    const start = request.mock.calls.find(([method]) => method === 'turn/start')?.[1] as { clientUserMessageId: string }
    expect(steer.clientUserMessageId).toBe(start.clientUserMessageId)
    expect(runtime.snapshot().asyncQuestions.currentId).toBeNull()
    await runtime.dispose()
  })

  it('does not send while suspended or reconnect after disposal', async () => {
    const { runtime, request, question } = await setup()
    question()
    await runtime.handleAsyncQuestionAction({ type: 'answer', index: 0, text: 'Saved answer' })
    runtime.setSuspended(true)
    await runtime.handleAsyncQuestionAction({ type: 'send', index: 0 })
    expect(runtime.snapshot().asyncQuestions.history[0]?.answers).toEqual(['Saved answer'])
    expect(request.mock.calls.some(([method]) => method === 'turn/start' || method === 'turn/steer')).toBe(false)
    await runtime.dispose()
    await runtime.handleAsyncQuestionAction({ type: 'send', index: 0, text: 'Late click' })
    expect(request.mock.calls.some(([method]) => method === 'turn/start' || method === 'turn/steer')).toBe(false)
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  hasPromptSubmissionContent,
  resolvePromptControlsReadinessError,
  runAfterPromptControlsReady,
  runThreadHydrationWithoutPromptControlsGate,
  withPromptControlsTimeout
} from '../app/utils/prompt-controls-readiness'

type Deferred<Value> = {
  promise: Promise<Value>
  resolve: (value: Value) => void
  reject: (reason?: unknown) => void
}

const deferred = <Value>(): Deferred<Value> => {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

describe('prompt controls readiness gate', () => {
  it('waits for model/list before starting a projectless first thread and turn', async () => {
    const modelList = deferred<{ data: Array<{ model: string }> }>()
    const request = vi.fn(async (method: 'model/list' | 'thread/start' | 'turn/start') => {
      if (method === 'model/list') {
        return await modelList.promise
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-1' } }
      }
      return { turn: { id: 'turn-1' } }
    })

    const firstSubmit = (async () => {
      const thread = await runAfterPromptControlsReady(
        async () => {
          const response = await request('model/list') as { data: Array<{ model: string }> }
          if (response.data.length === 0) {
            throw new Error('No selectable models')
          }
        },
        async () => (await request('thread/start') as { thread: { id: string } }).thread
      )

      await request('turn/start')
      return thread
    })()

    await Promise.resolve()

    expect(request.mock.calls.map(([method]) => method)).toEqual(['model/list'])

    modelList.resolve({ data: [{ model: 'gpt-5.6-sol' }] })

    await expect(firstSubmit).resolves.toEqual({ id: 'thread-1' })
    expect(request.mock.calls.map(([method]) => method)).toEqual([
      'model/list',
      'thread/start',
      'turn/start'
    ])
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('does not start a thread or turn when model/list fails', async () => {
    const request = vi.fn(async (method: 'model/list' | 'thread/start') => {
      if (method === 'model/list') {
        throw new Error('model/list unavailable')
      }
      return { thread: { id: 'thread-1' } }
    })

    await expect(runAfterPromptControlsReady(
      async () => {
        await request('model/list')
      },
      async () => await request('thread/start')
    )).rejects.toThrow('model/list unavailable')

    expect(request.mock.calls.map(([method]) => method)).toEqual(['model/list'])
  })

  it('hydrates an existing transcript without waiting for prompt controls', async () => {
    const promptControls = deferred<void>()
    const syncPromptSelection = vi.fn()
    const hydrateThread = vi.fn(async () => ({ threadId: 'thread-1' }))
    const hydration = runThreadHydrationWithoutPromptControlsGate(
      async () => await promptControls.promise,
      hydrateThread,
      syncPromptSelection
    )

    await expect(hydration).resolves.toEqual({
      threadId: 'thread-1'
    })
    expect(hydrateThread).toHaveBeenCalledOnce()
    expect(syncPromptSelection).not.toHaveBeenCalled()

    promptControls.resolve()
    await vi.waitFor(() => {
      expect(syncPromptSelection).toHaveBeenCalledOnce()
    })
  })

  it('keeps a prompt-control failure out of existing transcript hydration', async () => {
    const syncPromptSelection = vi.fn()

    await expect(runThreadHydrationWithoutPromptControlsGate(
      async () => {
        throw new Error('model/list unavailable')
      },
      async () => ({ threadId: 'thread-1' }),
      syncPromptSelection
    )).resolves.toEqual({ threadId: 'thread-1' })
    await Promise.resolve()

    expect(syncPromptSelection).not.toHaveBeenCalled()
  })

  it('keeps empty submissions out of prompt-control loading', () => {
    expect(hasPromptSubmissionContent('   ', 0)).toBe(false)
    expect(hasPromptSubmissionContent('hello', 0)).toBe(true)
    expect(hasPromptSubmissionContent('', 1)).toBe(true)
  })

  it('provides a visible fallback when a loaded selection becomes invalid', () => {
    expect(resolvePromptControlsReadinessError(null)).toBe(
      'A valid app-server model selection is required.'
    )
    expect(resolvePromptControlsReadinessError('Models are unavailable')).toBe(
      'Models are unavailable'
    )
  })

  it('releases the submission gate when model/list never responds', async () => {
    const startThread = vi.fn()

    await expect(runAfterPromptControlsReady(
      async () => await withPromptControlsTimeout(
        new Promise<never>(() => {}),
        'model list',
        1
      ),
      startThread
    )).rejects.toThrow('Timed out waiting for Codex app-server model list.')

    expect(startThread).not.toHaveBeenCalled()
  })
})

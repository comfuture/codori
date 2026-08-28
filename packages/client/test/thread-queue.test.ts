import { nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useThreadQueue } from '../app/composables/useThreadQueue'
import {
  buildTextThreadQueueInput,
  moveThreadQueueSubmission,
  startObservedThreadQueueSubmission,
  validateTextThreadQueueDraft
} from '../shared/thread-queue'
import type { QueuedSubmission } from '../shared/generated/codex-app-server/v2/QueuedSubmission'
import type { ThreadQueueListResponse } from '../shared/generated/codex-app-server/v2/ThreadQueueListResponse'

const queued = (id: string, text: string): QueuedSubmission => ({
  id,
  clientUserMessageId: `client-${id}`,
  input: buildTextThreadQueueInput(text)
})

describe('thread queue', () => {
  it('rejects unsupported draft shapes before they can be cleared', () => {
    expect(validateTextThreadQueueDraft({
      text: 'follow up',
      attachmentCount: 1,
      mentionCount: 0,
      skillMentionCount: 0
    })).toContain('text-only')
    expect(validateTextThreadQueueDraft({
      text: '@agent follow up',
      attachmentCount: 0,
      mentionCount: 1,
      skillMentionCount: 0
    })).toContain('@ mentions')
    expect(validateTextThreadQueueDraft({
      text: '$review follow up',
      attachmentCount: 0,
      mentionCount: 0,
      skillMentionCount: 1
    })).toContain('$skill')
    expect(validateTextThreadQueueDraft({
      text: '/review',
      attachmentCount: 0,
      mentionCount: 0,
      skillMentionCount: 0
    })).toContain('Slash commands')
    expect(validateTextThreadQueueDraft({
      text: 'follow up',
      attachmentCount: 0,
      mentionCount: 0,
      skillMentionCount: 0
    })).toBeNull()
  })

  it('reorders stable queue entries without mutating the source', () => {
    const source = [queued('one', 'one'), queued('two', 'two'), queued('three', 'three')]
    const moved = moveThreadQueueSubmission(source, 'three', -1)
    expect(moved.map(item => item.id)).toEqual(['one', 'three', 'two'])
    expect(source.map(item => item.id)).toEqual(['one', 'two', 'three'])
  })

  it('loads every queue page in server order and removes duplicate ids across pages', async () => {
    const requestSpy = vi.fn()
    const request = async <T>(method: string, params?: unknown): Promise<T> => {
      requestSpy(method, params)
      const cursor = (params as { cursor: string | null }).cursor
      return (cursor === null
        ? { data: [queued('one', 'one'), queued('two', 'two')], nextCursor: 'page-two' }
        : { data: [queued('two', 'two'), queued('three', 'three')], nextCursor: null }) as T
    }
    const threadId = ref<string | null>('thread-one')
    const queue = useThreadQueue({ threadId, getClient: () => ({ request }) })
    await queue.refresh()

    expect(queue.submissions.value.map(item => item.id)).toEqual(['one', 'two', 'three'])
    expect(requestSpy).toHaveBeenCalledTimes(2)
    queue.dispose()
  })

  it('paginates, deduplicates concurrent refreshes, and ignores stale thread responses', async () => {
    const firstResponse = Promise.withResolvers<ThreadQueueListResponse>()
    const requestSpy = vi.fn()
    const request = async <T>(method: string, params?: unknown): Promise<T> => {
      requestSpy(method, params)
      const threadId = (params as { threadId: string }).threadId
      if (threadId === 'thread-one') {
        return await firstResponse.promise as T
      }
      return {
        data: [queued('new', 'new thread')],
        nextCursor: null
      } as T
    }
    const threadId = ref<string | null>('thread-one')
    const queue = useThreadQueue({ threadId, getClient: () => ({ request }) })
    await nextTick()
    const concurrent = queue.refresh()
    expect(requestSpy).toHaveBeenCalledTimes(1)

    threadId.value = 'thread-two'
    await nextTick()
    expect(requestSpy.mock.calls.some(([, params]) => (params as { threadId: string }).threadId === 'thread-two')).toBe(true)
    firstResponse.resolve({ data: [queued('old', 'old thread')], nextCursor: null })
    await concurrent
    await queue.refresh()

    expect(queue.submissions.value.map(item => item.id)).toEqual(['new'])
    expect(requestSpy.mock.calls.filter(([, params]) => (params as { threadId: string }).threadId === 'thread-one')).toHaveLength(1)
    queue.dispose()
  })

  it('refreshes after notifications and restores server state after a failed optimistic edit', async () => {
    let serverQueue = [queued('one', 'first')]
    const requestSpy = vi.fn()
    const request = async <T>(method: string, params?: unknown): Promise<T> => {
      requestSpy(method, params)
      if (method === 'thread/queue/list') {
        return { data: serverQueue, nextCursor: null } as T
      }
      if (method === 'thread/queue/update') {
        throw new Error('write conflict')
      }
      throw new Error(`Unexpected ${method}`)
    }
    const threadId = ref<string | null>('thread-one')
    const queue = useThreadQueue({ threadId, getClient: () => ({ request }) })
    await queue.refresh()

    await expect(queue.update('one', 'changed')).rejects.toThrow('write conflict')
    expect(queue.submissions.value).toEqual(serverQueue)
    expect(queue.error.value).toContain('Updating the queued prompt failed')

    serverQueue = [queued('one', 'first'), queued('two', 'external')]
    queue.handleNotification({
      method: 'thread/queue/changed',
      params: { threadId: 'thread-one' }
    })
    await queue.refresh()
    expect(queue.submissions.value.map(item => item.id)).toEqual(['one', 'two'])
    queue.dispose()
  })

  it('tracks active-thread lifecycle notifications after a controller remount', async () => {
    const request = async <T>(): Promise<T> => ({
      data: [queued('one', 'still queued')],
      nextCursor: null
    }) as T
    const threadId = ref<string | null>('thread-one')
    const queue = useThreadQueue({ threadId, getClient: () => ({ request }) })
    await queue.refresh()

    queue.handleNotification({
      method: 'turn/completed',
      params: { threadId: 'thread-one', status: 'interrupted' }
    } as unknown as import('../shared/codex-rpc').CodexRpcNotification)
    expect(queue.paused.value).toBe(true)

    queue.handleNotification({
      method: 'turn/started',
      params: { threadId: 'thread-one' }
    } as unknown as import('../shared/codex-rpc').CodexRpcNotification)
    expect(queue.paused.value).toBe(false)
    queue.dispose()
  })

  it('hides queue support when an older app-server rejects the method', async () => {
    const request = vi.fn(async () => {
      throw new Error('JSON-RPC -32601: method not found')
    })
    const threadId = ref<string | null>('thread-one')
    const queue = useThreadQueue({ threadId, getClient: () => ({ request }) })
    await queue.refresh()

    expect(queue.supported.value).toBe(false)
    expect(queue.error.value).toBeNull()
    queue.dispose()
  })

  it('does not let a completed mutation from the previous thread overwrite the current queue', async () => {
    const addResponse = Promise.withResolvers<{ queuedSubmission: QueuedSubmission }>()
    const request = async <T>(method: string, params?: unknown): Promise<T> => {
      const threadId = (params as { threadId: string }).threadId
      if (method === 'thread/queue/add') {
        return await addResponse.promise as T
      }
      return {
        data: threadId === 'thread-one'
          ? [queued('one', 'first thread')]
          : [queued('two', 'second thread')],
        nextCursor: null
      } as T
    }
    const threadId = ref<string | null>('thread-one')
    const queue = useThreadQueue({ threadId, getClient: () => ({ request }) })
    await queue.refresh()
    const pendingAdd = queue.add('late addition', 'client-late')

    threadId.value = 'thread-two'
    await nextTick()
    await queue.refresh()
    addResponse.resolve({ queuedSubmission: queued('late', 'late addition') })
    await pendingAdd

    expect(queue.submissions.value.map(item => item.id)).toEqual(['two'])
    queue.dispose()
  })

  it('restores the paused queue state from an interrupted hydrated turn', async () => {
    const request = async <T>(): Promise<T> => ({
      data: [queued('one', 'still queued')],
      nextCursor: null
    }) as T
    const threadId = ref<string | null>('thread-one')
    const queue = useThreadQueue({
      threadId,
      getClient: () => ({ request }),
      getLastTurnStatus: () => 'interrupted'
    })

    await queue.refresh()
    expect(queue.paused.value).toBe(true)

    queue.restoreFromTurnStatus('completed')
    expect(queue.paused.value).toBe(false)
    queue.dispose()
  })

  it('subscribes before starting and rejects an ABA observer replacement', async () => {
    const events: string[] = []
    const capturedStream = { threadId: 'thread-one', observer: 'captured' }
    let currentStream = capturedStream
    const started = await startObservedThreadQueueSubmission({
      ensureObserved: async () => {
        events.push('subscribe')
        return capturedStream
      },
      isCurrent: liveStream => liveStream === currentStream,
      start: async () => {
        events.push('start')
        currentStream = { threadId: 'thread-one', observer: 'replacement' }
        return { id: 'turn-one' }
      }
    })

    expect(events).toEqual(['subscribe', 'start'])
    expect(started).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  isThreadSummaryRunning,
  normalizeThreadSummaryStatus,
  useThreadSummaries
} from '../app/composables/useThreadSummaries'

let stateSequence = 0

const createSummaries = () => {
  stateSequence += 1
  return useThreadSummaries(`thread-summaries-test-${stateSequence}`)
}

describe('thread summaries', () => {
  it('normalizes generated thread statuses defensively', () => {
    expect(normalizeThreadSummaryStatus({ type: 'idle' })).toEqual({ type: 'idle' })
    expect(normalizeThreadSummaryStatus({
      type: 'active',
      activeFlags: ['waitingOnApproval', 'futureFlag', 'waitingOnUserInput']
    })).toEqual({
      type: 'active',
      activeFlags: ['waitingOnApproval', 'waitingOnUserInput']
    })
    expect(normalizeThreadSummaryStatus({ type: 'active' })).toEqual({
      type: 'active',
      activeFlags: []
    })
    expect(normalizeThreadSummaryStatus({ type: 'futureStatus' })).toEqual({ type: 'unknown' })
    expect(normalizeThreadSummaryStatus(null)).toEqual({ type: 'unknown' })
    expect(isThreadSummaryRunning({ type: 'active', activeFlags: [] })).toBe(true)
    expect(isThreadSummaryRunning({ type: 'unknown' })).toBe(false)
  })

  it('hydrates list entries with normalized statuses and preserves known status when omitted', () => {
    const summaries = createSummaries()
    summaries.setThreads([{
      id: 'thread-1',
      title: 'First',
      updatedAt: 10,
      status: { type: 'active', activeFlags: [] }
    }, {
      id: 'thread-2',
      title: 'Second',
      updatedAt: 20
    }])

    expect(summaries.threads.value).toEqual([{
      id: 'thread-2',
      title: 'Second',
      updatedAt: 20,
      status: { type: 'unknown' }
    }, {
      id: 'thread-1',
      title: 'First',
      updatedAt: 10,
      status: { type: 'active', activeFlags: [] }
    }])

    summaries.setThreads([{
      id: 'thread-1',
      title: 'First refreshed',
      updatedAt: 30
    }])

    expect(summaries.threads.value[0]).toEqual({
      id: 'thread-1',
      title: 'First refreshed',
      updatedAt: 30,
      status: { type: 'active', activeFlags: [] }
    })
  })

  it('updates a full-thread summary status while retaining status during title-only changes', () => {
    const summaries = createSummaries()
    summaries.syncThreadSummary({
      id: 'thread-1',
      name: 'Initial title',
      preview: '',
      updatedAt: 10,
      status: { type: 'idle' }
    })
    summaries.syncThreadSummary({
      id: 'thread-1',
      name: 'Hydrated title',
      preview: '',
      updatedAt: 20,
      status: { type: 'systemError' }
    })
    summaries.updateThreadSummaryTitle('thread-1', 'Renamed title')

    expect(summaries.threads.value).toEqual([{
      id: 'thread-1',
      title: 'Renamed title',
      updatedAt: 20,
      status: { type: 'systemError' }
    }])
  })

  it('updates status without changing recency or ordering', () => {
    const summaries = createSummaries()
    summaries.setThreads([{
      id: 'newer',
      title: 'Newer',
      updatedAt: 20,
      status: { type: 'idle' }
    }, {
      id: 'older',
      title: 'Older',
      updatedAt: 10,
      status: { type: 'idle' }
    }])

    summaries.updateThreadSummaryStatus('older', {
      type: 'active',
      activeFlags: ['waitingOnUserInput']
    })

    expect(summaries.threads.value.map(thread => [thread.id, thread.updatedAt])).toEqual([
      ['newer', 20],
      ['older', 10]
    ])
    expect(summaries.threads.value[1]?.status).toEqual({
      type: 'active',
      activeFlags: ['waitingOnUserInput']
    })
  })

  it('keeps a newer status notification over delayed hydration', () => {
    const summaries = createSummaries()
    summaries.setThreads([{
      id: 'thread-1',
      title: 'Thread',
      updatedAt: 10,
      status: { type: 'idle' }
    }])
    const requestStatusRevision = summaries.getStatusRevision()

    summaries.updateThreadSummaryStatus('thread-1', {
      type: 'active',
      activeFlags: []
    })
    summaries.setThreads([{
      id: 'thread-1',
      title: 'Thread from delayed list',
      updatedAt: 20,
      status: { type: 'idle' }
    }], {
      statusRevision: requestStatusRevision
    })

    expect(summaries.threads.value[0]).toEqual({
      id: 'thread-1',
      title: 'Thread from delayed list',
      updatedAt: 20,
      status: { type: 'active', activeFlags: [] }
    })

    const nextRequestStatusRevision = summaries.getStatusRevision()
    summaries.setThreads([{
      id: 'thread-1',
      title: 'Thread from newer list',
      updatedAt: 30,
      status: { type: 'idle' }
    }], {
      statusRevision: nextRequestStatusRevision
    })

    expect(summaries.threads.value[0]?.status).toEqual({ type: 'idle' })
  })

  it('applies a status received before its thread summary arrives', () => {
    const summaries = createSummaries()
    summaries.updateThreadSummaryStatus('thread-late', {
      type: 'active',
      activeFlags: []
    })
    summaries.syncThreadSummary({
      id: 'thread-late',
      name: 'Late thread',
      preview: '',
      updatedAt: 50,
      status: { type: 'idle' }
    })

    expect(summaries.threads.value).toEqual([{
      id: 'thread-late',
      title: 'Late thread',
      updatedAt: 50,
      status: { type: 'active', activeFlags: [] }
    }])
  })

  it('removes a thread summary and any pending status override', () => {
    const summaries = createSummaries()
    summaries.updateThreadSummaryStatus('thread-removed', {
      type: 'active',
      activeFlags: []
    })
    summaries.syncThreadSummary({
      id: 'thread-removed',
      name: 'Removed thread',
      preview: '',
      updatedAt: 10,
      status: { type: 'idle' }
    })

    summaries.removeThreadSummary('thread-removed')
    summaries.syncThreadSummary({
      id: 'thread-removed',
      name: 'Restored thread',
      preview: '',
      updatedAt: 20,
      status: { type: 'idle' }
    })

    expect(summaries.threads.value).toEqual([{
      id: 'thread-removed',
      title: 'Restored thread',
      updatedAt: 20,
      status: { type: 'idle' }
    }])
  })
})

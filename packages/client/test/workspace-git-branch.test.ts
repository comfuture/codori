// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  shouldRefreshWorkspaceGitBranchOnActivity,
  useWorkspaceGitBranch
} from '../app/composables/useWorkspaceGitBranch'

const jsonResponse = <T>(body: T, ok = true) => ({
  ok,
  json: async () => body
}) as unknown as Response

const invalidJsonResponse = (ok = false) => ({
  ok,
  json: async () => {
    throw new SyntaxError('Unexpected token < in JSON')
  }
}) as unknown as Response

describe('useWorkspaceGitBranch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('hides the branch control after loading a non-git workspace', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      currentBranch: null,
      branches: []
    }))

    const manager = useWorkspaceGitBranch({
      projectId: `project-${Date.now()}`,
      serverBase: ''
    })

    await manager.refreshBranches({ force: true })

    expect(manager.showBranchControl.value).toBe(false)
    expect(manager.currentBranch.value).toBeNull()
    expect(manager.branches.value).toEqual([])
  })

  it('refreshes the current branch on activity boundaries after an external change', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-23T00:00:00Z'))

    fetchMock.mockResolvedValueOnce(jsonResponse({
      currentBranch: 'main',
      branches: ['feature/demo', 'main']
    }))
    fetchMock.mockResolvedValueOnce(jsonResponse({
      currentBranch: 'feature/demo',
      branches: ['feature/demo', 'main']
    }))

    const manager = useWorkspaceGitBranch({
      projectId: `project-${Date.now()}`,
      serverBase: ''
    })

    await manager.refreshBranches({ force: true })
    expect(manager.currentBranch.value).toBe('main')

    vi.advanceTimersByTime(751)
    await manager.refreshBranchesForActivity('turn/completed')

    expect(manager.currentBranch.value).toBe('feature/demo')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to the provided message when an error response is not valid JSON', async () => {
    fetchMock.mockResolvedValueOnce(invalidJsonResponse(false))

    const manager = useWorkspaceGitBranch({
      projectId: `project-${Date.now()}`,
      serverBase: ''
    })

    await expect(manager.refreshBranches({ force: true })).rejects.toThrow('Failed to load local branches.')
    expect(manager.error.value).toBe('Failed to load local branches.')
  })

  it('reuses the in-flight refresh request for activity updates', async () => {
    let resolveFetch: ((response: Response) => void) | undefined
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => {
      resolveFetch = resolve
    }))

    const manager = useWorkspaceGitBranch({
      projectId: `project-${Date.now()}`,
      serverBase: ''
    })

    const firstRefresh = manager.refreshBranchesForActivity('turn/completed')
    const secondRefresh = manager.refreshBranchesForActivity('turn/completed')

    expect(fetchMock).toHaveBeenCalledTimes(1)

    expect(resolveFetch).toBeTypeOf('function')
    resolveFetch!(jsonResponse({
      currentBranch: 'main',
      branches: ['feature/demo', 'main']
    }))

    await expect(firstRefresh).resolves.toEqual({
      currentBranch: 'main',
      branches: ['feature/demo', 'main']
    })
    await expect(secondRefresh).resolves.toEqual({
      currentBranch: 'main',
      branches: ['feature/demo', 'main']
    })
  })

  it('tracks only the defined branch refresh activity boundaries', () => {
    expect(shouldRefreshWorkspaceGitBranchOnActivity('submit')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnActivity('turn/start')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnActivity('item/completed')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnActivity('item/agentMessage/delta')).toBe(false)
  })
})

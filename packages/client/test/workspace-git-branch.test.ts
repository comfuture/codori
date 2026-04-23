// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  shouldRefreshWorkspaceGitBranchOnEnvironmentSignal,
  shouldRefreshWorkspaceGitBranchOnActivity,
  WORKSPACE_GIT_BRANCH_ENVIRONMENT_REFRESH_INTERVAL_MS,
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

  it('does not fetch branches when git is unsupported', async () => {
    const manager = useWorkspaceGitBranch({
      projectId: `chat-${Date.now()}`,
      serverBase: '',
      supportsGit: () => false
    })

    await expect(manager.refreshBranches({ force: true })).resolves.toEqual({
      currentBranch: null,
      branches: []
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(manager.loaded.value).toBe(true)
    expect(manager.showBranchControl.value).toBe(false)
  })

  it('does not mutate branches when git is unsupported', async () => {
    const manager = useWorkspaceGitBranch({
      projectId: `chat-${Date.now()}`,
      serverBase: '',
      supportsGit: () => false
    })

    await expect(manager.switchBranch('main')).resolves.toBeNull()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(manager.error.value).toBe('Git branch operations are not available for chat sessions.')
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

  it('refreshes on environment signals with a longer throttle window', async () => {
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
    await expect(manager.refreshBranchesForEnvironmentSignal('window/interaction')).resolves.toBeNull()

    vi.advanceTimersByTime(WORKSPACE_GIT_BRANCH_ENVIRONMENT_REFRESH_INTERVAL_MS)
    await manager.refreshBranchesForEnvironmentSignal('window/interaction')

    expect(manager.currentBranch.value).toBe('feature/demo')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tracks only the defined environment refresh boundaries', () => {
    expect(shouldRefreshWorkspaceGitBranchOnEnvironmentSignal('window/visible')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnEnvironmentSignal('window/interaction')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnEnvironmentSignal('turn/completed')).toBe(false)
  })

  it('tracks only the defined branch refresh activity boundaries', () => {
    expect(shouldRefreshWorkspaceGitBranchOnActivity('submit')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnActivity('turn/start')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnActivity('item/completed')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnActivity('item/agentMessage/delta')).toBe(false)
  })
})

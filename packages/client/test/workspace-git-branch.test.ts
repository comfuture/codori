// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  shouldRefreshWorkspaceGitBranchOnActivity,
  useWorkspaceGitBranch
} from '../app/composables/useWorkspaceGitBranch'

const jsonResponse = <T>(body: T, ok = true) => ({
  ok,
  json: async () => body
}) as Response

describe('useWorkspaceGitBranch', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
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

    await manager.refreshBranchesForActivity('turn/completed')

    expect(manager.currentBranch.value).toBe('feature/demo')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('tracks only the defined branch refresh activity boundaries', () => {
    expect(shouldRefreshWorkspaceGitBranchOnActivity('submit')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnActivity('item/completed')).toBe(true)
    expect(shouldRefreshWorkspaceGitBranchOnActivity('item/agentMessage/delta')).toBe(false)
  })
})

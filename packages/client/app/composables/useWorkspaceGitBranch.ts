import { computed, ref } from 'vue'
import {
  resolveProjectGitBranchCreateUrl,
  resolveProjectGitBranchesUrl,
  resolveProjectGitBranchSwitchUrl,
  type ProjectGitBranchMutationRequest,
  type ProjectGitBranchesResponse
} from '~~/shared/codori'

export const WORKSPACE_GIT_BRANCH_REFRESH_BOUNDARIES = new Set([
  'mount',
  'thread/load',
  'thread/start',
  'thread/resume',
  'turn/start',
  'turn/completed',
  'item/start',
  'item/completed',
  'submit'
])

export const shouldRefreshWorkspaceGitBranchOnActivity = (activity: string) =>
  WORKSPACE_GIT_BRANCH_REFRESH_BOUNDARIES.has(activity)

type UseWorkspaceGitBranchOptions = {
  projectId: string
  serverBase: string
}

type RefreshWorkspaceGitBranchOptions = {
  force?: boolean
  silent?: boolean
}

const MIN_REFRESH_INTERVAL_MS = 750

const readJsonResponse = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
  const body = await response.json() as T | { error?: { message?: string } }
  if (!response.ok) {
    throw new Error(body && typeof body === 'object' && 'error' in body
      ? body.error?.message ?? fallbackMessage
      : fallbackMessage)
  }

  return body as T
}

export const useWorkspaceGitBranch = (options: UseWorkspaceGitBranchOptions) => {
  const currentBranch = ref<string | null>(null)
  const branches = ref<string[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const submitting = ref(false)
  const error = ref<string | null>(null)

  let lastRefreshAt = 0
  let inflightRefresh: Promise<ProjectGitBranchesResponse> | null = null

  const applyBranchState = (result: ProjectGitBranchesResponse) => {
    currentBranch.value = result.currentBranch
    branches.value = result.branches
    loaded.value = true
    error.value = null
    lastRefreshAt = Date.now()
    return result
  }

  const refreshBranches = async (refreshOptions: RefreshWorkspaceGitBranchOptions = {}) => {
    const forceRefresh = refreshOptions.force === true
    const silentRefresh = refreshOptions.silent === true

    if (!forceRefresh && inflightRefresh) {
      return await inflightRefresh
    }

    if (!forceRefresh && loaded.value && Date.now() - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) {
      return {
        currentBranch: currentBranch.value,
        branches: branches.value.slice()
      }
    }

    if (!silentRefresh) {
      loading.value = true
    }

    const request = (async () => {
      const response = await fetch(resolveProjectGitBranchesUrl({
        projectId: options.projectId,
        configuredBase: options.serverBase
      }))

      return await readJsonResponse<ProjectGitBranchesResponse>(
        response,
        'Failed to load local branches.'
      )
    })()

    inflightRefresh = request

    try {
      return applyBranchState(await request)
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
      loaded.value = true
      throw caughtError
    } finally {
      if (inflightRefresh === request) {
        inflightRefresh = null
      }

      if (!silentRefresh) {
        loading.value = false
      }
    }
  }

  const refreshBranchesForActivity = async (activity: string) => {
    if (!shouldRefreshWorkspaceGitBranchOnActivity(activity)) {
      return null
    }

    try {
      return await refreshBranches({
        force: true,
        silent: loaded.value
      })
    } catch {
      return null
    }
  }

  const mutateBranchState = async (
    pathResolver: (input: { projectId: string, configuredBase?: string | null }) => string,
    branch: string,
    fallbackMessage: string
  ) => {
    const trimmedBranch = branch.trim()
    if (!trimmedBranch) {
      error.value = 'Branch name is required.'
      return null
    }

    submitting.value = true
    error.value = null

    try {
      const response = await fetch(pathResolver({
        projectId: options.projectId,
        configuredBase: options.serverBase
      }), {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          branch: trimmedBranch
        } satisfies ProjectGitBranchMutationRequest)
      })

      const result = await readJsonResponse<ProjectGitBranchesResponse>(
        response,
        fallbackMessage
      )
      return applyBranchState(result)
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
      throw caughtError
    } finally {
      submitting.value = false
      loading.value = false
    }
  }

  const switchBranch = async (branch: string) =>
    await mutateBranchState(
      resolveProjectGitBranchSwitchUrl,
      branch,
      'Failed to switch local branches.'
    )

  const createBranch = async (branch: string) =>
    await mutateBranchState(
      resolveProjectGitBranchCreateUrl,
      branch,
      'Failed to create a local branch.'
    )

  const showBranchControl = computed(() =>
    loaded.value && (Boolean(currentBranch.value) || branches.value.length > 0)
  )

  const availableBranches = computed(() =>
    branches.value.filter(branch => branch !== currentBranch.value)
  )

  return {
    currentBranch,
    branches,
    availableBranches,
    loaded,
    loading,
    submitting,
    error,
    showBranchControl,
    refreshBranches,
    refreshBranchesForActivity,
    switchBranch,
    createBranch
  }
}

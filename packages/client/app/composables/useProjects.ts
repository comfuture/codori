import { computed } from 'vue'
import { useRuntimeConfig, useState } from '#imports'
import { $fetch, type FetchError } from 'ofetch'
import { encodeProjectIdSegment } from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'
import {
  createProjectDiscoveryRunner,
  createProjectDiscoveryRunnerRegistry
} from '../utils/project-discovery'
import type {
  CreateProjectResponse,
  CreateProjectRequest,
  ProjectInventory,
  ProjectRecord,
  ProjectResponse,
  ProjectsResponse,
  ServiceUpdateResponse,
  ServiceUpdateStatus,
  StartProjectResult
} from '~~/shared/codori'

export type ProjectDiscoveryStatus = 'idle' | 'loading' | 'retrying' | 'ready' | 'error'

const projectDiscoveryRunners = createProjectDiscoveryRunnerRegistry<ProjectsResponse>()

const toProjectDiscoveryErrorMessage = (caughtError: unknown) => {
  const fetchError = caughtError as FetchError<{
    error?: {
      message?: string
    }
  }>
  return fetchError.data?.error?.message
    ?? (caughtError instanceof Error ? caughtError.message : String(caughtError))
}

export const isRetryableProjectDiscoveryError = (caughtError: unknown) => {
  const fetchError = caughtError as FetchError<{
    error?: {
      details?: { retryable?: boolean }
    }
  }>
  if (fetchError.data?.error?.details?.retryable === true) {
    return true
  }
  const status = fetchError.response?.status ?? fetchError.statusCode
  return status === undefined || status === 408 || status === 425 || status === 429
    || (status >= 500 && status !== 501)
}

const mergeProject = (projects: ProjectRecord[], nextProject: ProjectRecord) => {
  const filtered = projects.filter(project => project.projectId !== nextProject.projectId)
  return [...filtered, nextProject].sort((left, right) => left.projectId.localeCompare(right.projectId))
}

export const useProjects = () => {
  const projects = useState<ProjectRecord[]>('codori-projects', () => [])
  const serviceUpdate = useState<ServiceUpdateStatus>('codori-service-update', () => ({
    enabled: false,
    updateAvailable: false,
    updating: false,
    installedVersion: null,
    latestVersion: null
  }))
  const loaded = useState<boolean>('codori-projects-loaded', () => false)
  const inventory = useState<ProjectInventory | null>('codori-project-inventory', () => null)
  const discoveryStatus = useState<ProjectDiscoveryStatus>('codori-projects-discovery-status', () => 'idle')
  const discoveryAttempt = useState<number>('codori-projects-discovery-attempt', () => 0)
  const discoveryMaxAttempts = useState<number>('codori-projects-discovery-max-attempts', () => 1)
  const loading = computed(() => discoveryStatus.value === 'loading' || discoveryStatus.value === 'retrying')
  const clonePending = useState<boolean>('codori-projects-clone-pending', () => false)
  const serviceUpdatePending = useState<boolean>('codori-service-update-pending', () => false)
  const pendingProjectId = useState<string | null>('codori-projects-pending-id', () => null)
  const error = useState<string | null>('codori-projects-error', () => null)
  const configuredBase = String(useRuntimeConfig().public.serverBase ?? '')
  const useProxy = shouldUseServerProxy(configuredBase)

  const toApiUrl = (path: string) =>
    useProxy
      ? `/api/codori${path}`
      : resolveApiUrl(path, configuredBase)

  const projectDiscovery = projectDiscoveryRunners.get(projects, () =>
    createProjectDiscoveryRunner<ProjectsResponse>({
      discover: signal => $fetch<ProjectsResponse>(toApiUrl('/projects'), { signal }),
      isRetryable: isRetryableProjectDiscoveryError,
      onState: (state) => {
        discoveryStatus.value = state.status
        discoveryAttempt.value = state.attempt
        discoveryMaxAttempts.value = state.maxAttempts
        if (state.status === 'loading') {
          if (state.attempt === 1) {
            error.value = null
          }
          return
        }
        if (state.status === 'retrying' || state.status === 'error') {
          error.value = toProjectDiscoveryErrorMessage(state.error)
          return
        }
        projects.value = state.result.projects
        inventory.value = state.result.inventory
        loaded.value = true
        error.value = null
      }
    })
  )

  const refreshProjects = async () => {
    void $fetch<ServiceUpdateResponse>(toApiUrl('/service/update'))
      .then((response) => {
        serviceUpdate.value = response.serviceUpdate
      })
      .catch(() => {
        // Keep project discovery responsive even if the update check stalls or fails.
      })
    await projectDiscovery.start()
  }

  const cancelProjectDiscovery = () => {
    projectDiscovery.cancel()
  }

  const applyProjectResponse = (response: ProjectResponse) => {
    const nextProject = response.project as ProjectRecord
    projects.value = mergeProject(projects.value, nextProject)
    return nextProject
  }

  const startProject = async (projectId: string) => {
    pendingProjectId.value = projectId
    try {
      const response = await $fetch<ProjectResponse>(toApiUrl(
        `/projects/${encodeProjectIdSegment(projectId)}/start`
      ), {
        method: 'POST'
      })
      return applyProjectResponse(response) as StartProjectResult
    } finally {
      pendingProjectId.value = null
    }
  }

  const stopProject = async (projectId: string) => {
    pendingProjectId.value = projectId
    try {
      const response = await $fetch<ProjectResponse>(toApiUrl(
        `/projects/${encodeProjectIdSegment(projectId)}/stop`
      ), {
        method: 'POST'
      })
      return applyProjectResponse(response)
    } finally {
      pendingProjectId.value = null
    }
  }

  const createProject = async (input: CreateProjectRequest) => {
    if (clonePending.value) {
      throw new Error('A project creation is already in progress.')
    }
    clonePending.value = true
    error.value = null
    try {
      const response = await $fetch<CreateProjectResponse>(toApiUrl('/projects'), {
        method: 'POST',
        body: input
      })
      projects.value = response.projects
      inventory.value = response.inventory
      loaded.value = true
      discoveryStatus.value = 'ready'
      return response.project
    } finally {
      clonePending.value = false
    }
  }

  const getProject = (projectId: string | null) => {
    if (!projectId) {
      return null
    }
    return projects.value.find((project: ProjectRecord) => project.projectId === projectId)
      ?? null
  }

  const refreshServiceUpdate = async () => {
    try {
      const response = await $fetch<ServiceUpdateResponse>(toApiUrl('/service/update'))
      serviceUpdate.value = response.serviceUpdate
      return response.serviceUpdate
    } catch {
      // A failed check should never disrupt the session.
      return serviceUpdate.value
    }
  }

  const triggerServiceUpdate = async () => {
    if (serviceUpdatePending.value || serviceUpdate.value.updating) {
      return serviceUpdate.value
    }

    serviceUpdatePending.value = true
    error.value = null
    try {
      const response = await $fetch<ServiceUpdateResponse>(toApiUrl('/service/update'), {
        method: 'POST'
      })
      serviceUpdate.value = response.serviceUpdate
      return response.serviceUpdate
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
      return serviceUpdate.value
    } finally {
      serviceUpdatePending.value = false
    }
  }

  return {
    projects,
    inventory,
    serviceUpdate,
    loaded,
    loading,
    discoveryStatus,
    discoveryAttempt,
    discoveryMaxAttempts,
    clonePending,
    serviceUpdatePending,
    error,
    pendingProjectId,
    refreshProjects,
    cancelProjectDiscovery,
    refreshServiceUpdate,
    triggerServiceUpdate,
    createProject,
    startProject,
    stopProject,
    getProject
  }
}

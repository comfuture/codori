import { useRuntimeConfig, useState } from '#imports'
import { $fetch } from 'ofetch'
import { encodeProjectIdSegment } from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'
import type {
  CreateProjectResponse,
  CreateProjectRequest,
  ProjectRecord,
  ProjectResponse,
  ProjectsResponse,
  ServiceUpdateResponse,
  ServiceUpdateStatus,
  StartProjectResult
} from '~~/shared/codori'

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
    latestVersion: null,
    durableVersion: null,
    phase: null,
    failureReason: null
  }))
  const loaded = useState<boolean>('codori-projects-loaded', () => false)
  const loading = useState<boolean>('codori-projects-loading', () => false)
  const refreshQueued = useState<boolean>('codori-projects-refresh-queued', () => false)
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

  const refreshProjects = async () => {
    if (loading.value) {
      refreshQueued.value = true
      return
    }

    loading.value = true
    error.value = null
    try {
      void $fetch<ServiceUpdateResponse>(toApiUrl('/service/update'))
        .then((response) => {
          serviceUpdate.value = response.serviceUpdate
        })
        .catch(() => {
          // Keep project discovery responsive even if the update check stalls or fails.
        })

      const response = await $fetch<ProjectsResponse>(toApiUrl('/projects'))
      projects.value = response.projects
      loaded.value = true
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    } finally {
      loading.value = false
      if (refreshQueued.value) {
        refreshQueued.value = false
        void refreshProjects()
      }
    }
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
    serviceUpdate,
    loaded,
    loading,
    clonePending,
    serviceUpdatePending,
    error,
    pendingProjectId,
    refreshProjects,
    refreshServiceUpdate,
    triggerServiceUpdate,
    createProject,
    startProject,
    stopProject,
    getProject
  }
}

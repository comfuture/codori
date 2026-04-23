import { useRuntimeConfig, useState } from '#imports'
import { $fetch } from 'ofetch'
import { encodeProjectIdSegment } from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'
import type {
  CloneProjectRequest,
  ProjectlessChatsResponse,
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

const mergeProjectlessChat = (projects: ProjectRecord[], nextProject: ProjectRecord) => {
  const filtered = projects.filter(project => project.projectId !== nextProject.projectId)
  return [nextProject, ...filtered]
    .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
    .slice(0, 5)
}

export const useProjects = () => {
  const projects = useState<ProjectRecord[]>('codori-projects', () => [])
  const projectlessChats = useState<ProjectRecord[]>('codori-projectless-chats', () => [])
  const serviceUpdate = useState<ServiceUpdateStatus>('codori-service-update', () => ({
    enabled: false,
    updateAvailable: false,
    updating: false,
    installedVersion: null,
    latestVersion: null
  }))
  const loaded = useState<boolean>('codori-projects-loaded', () => false)
  const projectlessLoaded = useState<boolean>('codori-projectless-chats-loaded', () => false)
  const loading = useState<boolean>('codori-projects-loading', () => false)
  const projectlessLoading = useState<boolean>('codori-projectless-chats-loading', () => false)
  const clonePending = useState<boolean>('codori-projects-clone-pending', () => false)
  const projectlessCreatePending = useState<boolean>('codori-projectless-chats-create-pending', () => false)
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
    }
  }

  const applyProjectResponse = (response: ProjectResponse) => {
    const nextProject = response.project as ProjectRecord
    if (nextProject.workspaceKind === 'projectless') {
      projectlessChats.value = mergeProjectlessChat(projectlessChats.value, nextProject)
    } else {
      projects.value = mergeProject(projects.value, nextProject)
    }
    return nextProject
  }

  const refreshProjectlessChats = async () => {
    if (projectlessLoading.value) {
      return
    }

    projectlessLoading.value = true
    error.value = null
    try {
      const response = await $fetch<ProjectlessChatsResponse>(toApiUrl('/projectless-chats'))
      projectlessChats.value = response.projects.slice(0, 5)
      projectlessLoaded.value = true
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    } finally {
      projectlessLoading.value = false
    }
  }

  const createProjectlessChat = async () => {
    if (projectlessCreatePending.value) {
      throw new Error('A new chat is already being created.')
    }

    projectlessCreatePending.value = true
    error.value = null
    try {
      const response = await $fetch<ProjectResponse>(toApiUrl('/projectless-chats'), {
        method: 'POST'
      })
      projectlessLoaded.value = true
      return applyProjectResponse(response)
    } finally {
      projectlessCreatePending.value = false
    }
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

  const cloneProject = async (input: CloneProjectRequest) => {
    if (clonePending.value) {
      throw new Error('A project clone is already in progress.')
    }

    clonePending.value = true
    error.value = null
    try {
      const response = await $fetch<ProjectResponse>(toApiUrl('/projects/clone'), {
        method: 'POST',
        body: input
      })
      return applyProjectResponse(response)
    } finally {
      clonePending.value = false
    }
  }

  const getProject = (projectId: string | null) => {
    if (!projectId) {
      return null
    }
    return projects.value.find((project: ProjectRecord) => project.projectId === projectId)
      ?? projectlessChats.value.find((project: ProjectRecord) => project.projectId === projectId)
      ?? null
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
    projectlessChats,
    serviceUpdate,
    loaded,
    projectlessLoaded,
    loading,
    projectlessLoading,
    clonePending,
    projectlessCreatePending,
    serviceUpdatePending,
    error,
    pendingProjectId,
    refreshProjects,
    refreshProjectlessChats,
    triggerServiceUpdate,
    cloneProject,
    createProjectlessChat,
    startProject,
    stopProject,
    getProject
  }
}

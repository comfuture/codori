import { useRuntimeConfig, useState } from '#imports'
import { $fetch } from 'ofetch'
import { encodeProjectIdSegment } from '~~/shared/codori.js'
import { resolveHttpBase } from '~~/shared/network.js'
import type {
  ProjectRecord,
  ProjectResponse,
  ProjectsResponse,
  StartProjectResult
} from '~~/shared/codori.js'

const mergeProject = (projects: ProjectRecord[], nextProject: ProjectRecord) => {
  const filtered = projects.filter(project => project.projectId !== nextProject.projectId)
  return [...filtered, nextProject].sort((left, right) => left.projectId.localeCompare(right.projectId))
}

export const useProjects = () => {
  const projects = useState<ProjectRecord[]>('codori-projects', () => [])
  const loaded = useState<boolean>('codori-projects-loaded', () => false)
  const loading = useState<boolean>('codori-projects-loading', () => false)
  const pendingProjectId = useState<string | null>('codori-projects-pending-id', () => null)
  const error = useState<string | null>('codori-projects-error', () => null)
  const apiBase = resolveHttpBase(String(useRuntimeConfig().public.serverBase ?? ''))

  const refreshProjects = async () => {
    if (loading.value) {
      return
    }

    loading.value = true
    error.value = null
    try {
      const response = await $fetch<ProjectsResponse>(new URL('/api/projects', apiBase).toString())
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
    projects.value = mergeProject(projects.value, nextProject)
    return nextProject
  }

  const startProject = async (projectId: string) => {
    pendingProjectId.value = projectId
    try {
      const response = await $fetch<ProjectResponse>(new URL(
        `/api/projects/${encodeProjectIdSegment(projectId)}/start`,
        apiBase
      ).toString(), {
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
      const response = await $fetch<ProjectResponse>(new URL(
        `/api/projects/${encodeProjectIdSegment(projectId)}/stop`,
        apiBase
      ).toString(), {
        method: 'POST'
      })
      return applyProjectResponse(response)
    } finally {
      pendingProjectId.value = null
    }
  }

  const getProject = (projectId: string | null) => {
    if (!projectId) {
      return null
    }
    return projects.value.find((project: ProjectRecord) => project.projectId === projectId) ?? null
  }

  return {
    projects,
    loaded,
    loading,
    error,
    pendingProjectId,
    refreshProjects,
    startProject,
    stopProject,
    getProject
  }
}

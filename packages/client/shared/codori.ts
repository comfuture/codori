export type ProjectRuntimeStatus = 'running' | 'stopped' | 'error'

export type ProjectRecord = {
  projectId: string
  projectPath: string
  status: ProjectRuntimeStatus
  pid: number | null
  port: number | null
  startedAt: number | null
  error: string | null
}

export type StartProjectResult = ProjectRecord & {
  reusedExisting: boolean
}

export type ServiceUpdateStatus = {
  enabled: boolean
  updateAvailable: boolean
  updating: boolean
  installedVersion: string | null
  latestVersion: string | null
}

export type ProjectsResponse = {
  projects: ProjectRecord[]
  serviceUpdate: ServiceUpdateStatus
}

export type ProjectResponse = {
  project: ProjectRecord | StartProjectResult
}

export type ServiceUpdateResponse = {
  serviceUpdate: ServiceUpdateStatus
}

export const normalizeProjectIdParam = (value: string | string[] | undefined) => {
  if (!value) {
    return null
  }

  if (Array.isArray(value)) {
    return value.join('/')
  }

  return value
}

export const toProjectRoute = (projectId: string) => `/projects/${projectId}`

export const toProjectThreadRoute = (projectId: string, threadId: string) =>
  `/projects/${projectId}/threads/${encodeURIComponent(threadId)}`

export const encodeProjectIdSegment = (projectId: string) => encodeURIComponent(projectId)

export const projectStatusMeta = (status: ProjectRuntimeStatus) => {
  switch (status) {
    case 'running':
      return {
        color: 'success' as const,
        label: 'Running'
      }
    case 'error':
      return {
        color: 'error' as const,
        label: 'Error'
      }
    default:
      return {
        color: 'neutral' as const,
        label: 'Stopped'
      }
  }
}

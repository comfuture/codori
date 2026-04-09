export type CodoriConfig = {
  root: string
  server: {
    host: string
    port: number
  }
  ports: {
    start: number
    end: number
  }
}

export type ConfigOverrides = {
  root?: string
  host?: string
  port?: number
}

export type ProjectRecord = {
  id: string
  path: string
}

export type RuntimeRecord = {
  projectId: string
  projectPath: string
  pid: number
  port: number
  startedAt: number
}

export type ProjectRuntimeStatus = 'running' | 'stopped' | 'error'

export type ProjectStatusRecord = {
  projectId: string
  projectPath: string
  status: ProjectRuntimeStatus
  pid: number | null
  port: number | null
  startedAt: number | null
  error: string | null
}

export type StartProjectResult = ProjectStatusRecord & {
  reusedExisting: boolean
}


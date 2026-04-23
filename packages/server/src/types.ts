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
  idleShutdown: {
    enabled: boolean
    timeoutMs: number
    sweepIntervalMs: number
  }
}

export type ConfigOverrides = {
  root?: string
  host?: string
  port?: number
  idleShutdownEnabled?: boolean
  idleShutdownTimeoutMs?: number
  idleShutdownSweepIntervalMs?: number
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
  lastActivityAt: number
}

export type ProjectRuntimeStatus = 'running' | 'stopped' | 'error'

export type ProjectStatusRecord = {
  projectId: string
  projectPath: string
  status: ProjectRuntimeStatus
  pid: number | null
  port: number | null
  startedAt: number | null
  lastActivityAt: number | null
  activeSessionCount: number
  idleTimeoutMs: number | null
  idleDeadlineAt: number | null
  error: string | null
}

export type StartProjectResult = ProjectStatusRecord & {
  reusedExisting: boolean
}

export type ChatSessionRecord = {
  chatId: string
  chatPath: string
  threadId: string | null
  title: string | null
  createdAt: number
  updatedAt: number | null
}

export type ChatSessionStatusRecord = ChatSessionRecord & {
  status: ProjectRuntimeStatus
  pid: number | null
  port: number | null
  startedAt: number | null
  lastActivityAt: number | null
  activeSessionCount: number
  idleTimeoutMs: number | null
  idleDeadlineAt: number | null
  error: string | null
}

export type StartChatSessionResult = ChatSessionStatusRecord & {
  reusedExisting: boolean
}

export type DeleteChatSessionResult = {
  chatId: string
}

export type UpdateChatSessionTitleResult = ChatSessionStatusRecord

export type UpdateChatSessionThreadResult = ChatSessionStatusRecord

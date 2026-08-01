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
  realtimeVoice: {
    enabled: boolean
  }
}

export type ConfigOverrides = {
  root?: string
  host?: string
  port?: number
  idleShutdownEnabled?: boolean
  idleShutdownTimeoutMs?: number
  idleShutdownSweepIntervalMs?: number
  realtimeVoiceEnabled?: boolean
}

export type ServerCapabilitiesResponse = {
  capabilities: {
    realtimeVoice: {
      configured: boolean
      experimental: true
      feature: 'realtime_conversation'
    }
  }
}

export type ProjectRootResponse = {
  projectRoot: {
    root: string
    lastRoot: string | null
  }
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

export type RuntimeBackendFallbackReason =
  | 'unsupported-platform'
  | 'daemon-unavailable'
  | 'permission-denied'
  | 'daemon-unready'
  | 'daemon-start-failed'
  | 'invalid-daemon-response'
  | 'incompatible-realtime'
  | 'managed-runtime-stop-failed'

export type CodexDaemonTarget = {
  kind: 'codex-daemon'
  transport: 'unix-socket'
  socketPath: string
  ownedByCodori: false
  cliVersion: string | null
  appServerVersion: string | null
}

export type CodoriManagedTarget = {
  kind: 'codori-managed'
  transport: 'tcp-websocket'
  port: number
  pid: number
  ownedByCodori: true
  appServerVersion: string | null
}

export type AppServerTarget = CodexDaemonTarget | CodoriManagedTarget

export type RuntimeBackendStatus = {
  backend: AppServerTarget['kind'] | null
  transport: AppServerTarget['transport'] | null
  state: 'idle' | 'probing' | 'ready' | 'fallback'
  version: string | null
  fallbackReason: RuntimeBackendFallbackReason | null
}

export type RuntimeBackendStatusResponse = {
  backend: RuntimeBackendStatus
}

export type RuntimeBridgeTarget = {
  target: AppServerTarget
  workspacePath: string
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

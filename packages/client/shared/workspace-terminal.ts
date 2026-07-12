import type { InitializeResponse } from './generated/codex-app-server/InitializeResponse'
import type { ConfigReadParams } from './generated/codex-app-server/v2/ConfigReadParams'
import type { ConfigReadResponse } from './generated/codex-app-server/v2/ConfigReadResponse'
import type { CommandExecOutputDeltaNotification } from './generated/codex-app-server/v2/CommandExecOutputDeltaNotification'
import type { CommandExecParams } from './generated/codex-app-server/v2/CommandExecParams'
import type { CommandExecResizeParams } from './generated/codex-app-server/v2/CommandExecResizeParams'
import type { CommandExecResizeResponse } from './generated/codex-app-server/v2/CommandExecResizeResponse'
import type { CommandExecResponse } from './generated/codex-app-server/v2/CommandExecResponse'
import type { CommandExecTerminateParams } from './generated/codex-app-server/v2/CommandExecTerminateParams'
import type { CommandExecTerminateResponse } from './generated/codex-app-server/v2/CommandExecTerminateResponse'
import type { CommandExecWriteParams } from './generated/codex-app-server/v2/CommandExecWriteParams'
import type { CommandExecWriteResponse } from './generated/codex-app-server/v2/CommandExecWriteResponse'
import type {
  CodexRpcConnectionState,
  CodexRpcNotification
} from './codex-rpc'

export const TERMINAL_MAX_SESSIONS = 4
export const TERMINAL_OUTPUT_BYTES_CAP = 4 * 1024 * 1024
export const TERMINAL_WRITE_CHUNK_BYTES = 16 * 1024
export const TERMINAL_CLEANUP_TIMEOUT_MS = 750
export const TERMINAL_PERMISSION_LOOKUP_TIMEOUT_MS = 3_000
export const WORKSPACE_TERMINAL_TERM = 'xterm-256color'

export const canCreateWorkspaceTerminalSession = (sessionCount: number) =>
  Number.isInteger(sessionCount) && sessionCount >= 0 && sessionCount < TERMINAL_MAX_SESSIONS

export type WorkspaceTerminalState =
  | 'starting'
  | 'running'
  | 'terminating'
  | 'exited'
  | 'disconnected'
  | 'output-limit'
  | 'error'

export type WorkspaceTerminalPermission = {
  permissionProfile: string | null
  permissionLabel: string
  hasUnrestrictedFilesystemWrite: boolean
}

export type WorkspaceTerminalShell = WorkspaceTerminalPermission & {
  label: string
  command: string[]
}

type TerminalRpcMethodMap = {
  'config/read': { params: ConfigReadParams, response: ConfigReadResponse }
  'command/exec': { params: CommandExecParams, response: CommandExecResponse }
  'command/exec/write': { params: CommandExecWriteParams, response: CommandExecWriteResponse }
  'command/exec/resize': { params: CommandExecResizeParams, response: CommandExecResizeResponse }
  'command/exec/terminate': { params: CommandExecTerminateParams, response: CommandExecTerminateResponse }
}

export type WorkspaceTerminalRpcClient = {
  connect: () => Promise<void>
  close: () => void
  getInitializeResponse: () => InitializeResponse | null
  request: <T>(method: string, params?: unknown) => Promise<T>
  subscribe: (listener: (notification: CodexRpcNotification) => void) => () => void
  subscribeConnectionState: (listener: (state: CodexRpcConnectionState) => void) => () => void
}

export type WorkspaceTerminalEvent = {
  state: WorkspaceTerminalState
  exitCode?: number
  error?: string
}

const requestTerminalRpc = async <Method extends keyof TerminalRpcMethodMap>(
  client: WorkspaceTerminalRpcClient,
  method: Method,
  params: TerminalRpcMethodMap[Method]['params']
) => await client.request<TerminalRpcMethodMap[Method]['response']>(method, params)

const TERMINAL_BINARY_STRING_CHUNK_BYTES = 32 * 1024

export const encodeTerminalBytes = (bytes: Uint8Array) => {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += TERMINAL_BINARY_STRING_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + TERMINAL_BINARY_STRING_CHUNK_BYTES))
  }
  return btoa(binary)
}

export const decodeTerminalBytes = (base64: string) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

export const encodeTerminalBinaryInput = (value: string) =>
  Uint8Array.from(value, character => character.charCodeAt(0) & 0xff)

export const chunkTerminalBytes = (
  bytes: Uint8Array,
  chunkSize = TERMINAL_WRITE_CHUNK_BYTES
) => {
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error('Terminal chunk size must be a positive integer.')
  }

  const chunks: Uint8Array[] = []
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    chunks.push(bytes.slice(offset, offset + chunkSize))
  }
  return chunks
}

export const requiresTerminalPasteConfirmation = (text: string) =>
  text.length > 1024 || /[\r\n]/.test(text)

export const resolveTerminalLink = (event: Pick<MouseEvent, 'ctrlKey' | 'metaKey'>, value: string) => {
  if (!event.ctrlKey && !event.metaKey) {
    return null
  }

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

export const resolveWorkspaceTerminalShell = (
  server: Pick<InitializeResponse, 'platformFamily' | 'platformOs'>,
  permission: WorkspaceTerminalPermission
): WorkspaceTerminalShell => {
  if (server.platformOs === 'macos') {
    return {
      label: 'zsh',
      command: permission.hasUnrestrictedFilesystemWrite
        ? ['/bin/zsh', '-l']
        : ['/bin/zsh', '-f'],
      ...permission
    }
  }

  if (server.platformOs === 'linux' || server.platformFamily === 'unix') {
    return {
      label: 'sh',
      command: permission.hasUnrestrictedFilesystemWrite
        ? ['/bin/sh', '-l']
        : ['/bin/sh'],
      ...permission
    }
  }

  if (server.platformOs === 'windows' || server.platformFamily === 'windows') {
    return {
      label: 'PowerShell',
      command: permission.hasUnrestrictedFilesystemWrite
        ? ['powershell.exe', '-NoLogo']
        : ['powershell.exe', '-NoLogo', '-NoProfile'],
      ...permission
    }
  }

  throw new Error(`No supported interactive shell is configured for ${server.platformOs || server.platformFamily}.`)
}

const normalizeBuiltInPermissionProfile = (value: unknown) => {
  if (value === ':danger-full-access' || value === 'danger-full-access') {
    return ':danger-full-access'
  }
  if (value === ':workspace' || value === 'workspace-write') {
    return ':workspace'
  }
  if (value === ':read-only' || value === 'read-only') {
    return ':read-only'
  }
  return typeof value === 'string' && value.length > 0 ? value : null
}

export const resolveWorkspaceTerminalPermission = (config: {
  sandbox_mode?: unknown
  default_permissions?: unknown
} | null): WorkspaceTerminalPermission => {
  const configuredProfile = normalizeBuiltInPermissionProfile(config?.default_permissions)
    ?? normalizeBuiltInPermissionProfile(config?.sandbox_mode)

  if (configuredProfile === ':danger-full-access') {
    return {
      permissionProfile: configuredProfile,
      permissionLabel: 'Danger full access',
      hasUnrestrictedFilesystemWrite: true
    }
  }

  if (configuredProfile === ':workspace') {
    return {
      permissionProfile: configuredProfile,
      permissionLabel: 'Workspace sandbox',
      hasUnrestrictedFilesystemWrite: false
    }
  }

  if (configuredProfile === ':read-only') {
    return {
      permissionProfile: configuredProfile,
      permissionLabel: 'Read-only sandbox',
      hasUnrestrictedFilesystemWrite: false
    }
  }

  return {
    permissionProfile: configuredProfile,
    permissionLabel: configuredProfile ? `Restricted profile ${configuredProfile}` : 'Configured permissions',
    hasUnrestrictedFilesystemWrite: false
  }
}

const readWorkspaceTerminalPermission = async (
  client: WorkspaceTerminalRpcClient,
  cwd: string
) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    const response = await Promise.race([
      requestTerminalRpc(client, 'config/read', {
        includeLayers: false,
        cwd
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error('Timed out while reading Codex permissions.')),
          TERMINAL_PERMISSION_LOOKUP_TIMEOUT_MS
        )
      })
    ])
    return resolveWorkspaceTerminalPermission(response.config)
  } catch {
    return resolveWorkspaceTerminalPermission(null)
  } finally {
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
}

export const createWorkspaceTerminalProcessId = (sessionId: string) => {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  return `codori-terminal-${sessionId}-${randomId}`
}

export const createWorkspaceTerminalEmulatorKey = (options: {
  workspace: { kind: 'project' | 'chat', id: string }
  cwd: string
  sessionId: string
  generation: number
}) => JSON.stringify([
  options.workspace.kind,
  options.workspace.id,
  options.cwd,
  options.sessionId,
  options.generation
])

export const sanitizeWorkspaceTerminalSize = (size: { cols: number, rows: number }) => {
  const cols = Math.floor(size.cols)
  const rows = Math.floor(size.rows)
  return {
    cols: Number.isFinite(cols) && cols > 0 ? cols : 80,
    rows: Number.isFinite(rows) && rows > 0 ? rows : 24
  }
}

const asOutputDelta = (notification: CodexRpcNotification) =>
  notification.method === 'command/exec/outputDelta'
    ? notification.params as CommandExecOutputDeltaNotification
    : null

const waitForTerminalCleanup = async (promise: Promise<unknown>) => {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    await Promise.race([
      promise.catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TERMINAL_CLEANUP_TIMEOUT_MS)
      })
    ])
  } finally {
    if (timer !== null) {
      clearTimeout(timer)
    }
  }
}

export class WorkspaceTerminalProcess {
  private readonly client: WorkspaceTerminalRpcClient

  private readonly cwd: string

  private readonly processId: string

  private readonly onOutput: (bytes: Uint8Array) => void

  private readonly onEvent: (event: WorkspaceTerminalEvent) => void

  private readonly onShell: (shell: WorkspaceTerminalShell) => void

  private releaseNotification: (() => void) | null = null

  private releaseConnectionState: (() => void) | null = null

  private state: WorkspaceTerminalState = 'starting'

  private connectedOnce = false

  private disposed = false

  private outputLimitReached = false

  private lastSize: { cols: number, rows: number } | null = null

  private writeQueue: Promise<void> = Promise.resolve()

  private terminationPromise: Promise<void> | null = null

  private connectionClosed = false

  constructor(options: {
    client: WorkspaceTerminalRpcClient
    cwd: string
    processId: string
    onOutput: (bytes: Uint8Array) => void
    onEvent: (event: WorkspaceTerminalEvent) => void
    onShell: (shell: WorkspaceTerminalShell) => void
  }) {
    this.client = options.client
    this.cwd = options.cwd
    this.processId = options.processId
    this.onOutput = options.onOutput
    this.onEvent = options.onEvent
    this.onShell = options.onShell
  }

  async start(size: { cols: number, rows: number }) {
    if (this.disposed) {
      return
    }

    const terminalSize = sanitizeWorkspaceTerminalSize(size)
    this.releaseNotification = this.client.subscribe(notification => this.handleNotification(notification))
    this.releaseConnectionState = this.client.subscribeConnectionState(state => this.handleConnectionState(state))
    this.emit({ state: 'starting' })

    try {
      await this.client.connect()
      if (this.disposed) {
        return
      }

      const server = this.client.getInitializeResponse()
      if (!server) {
        throw new Error('The app-server did not report its platform information.')
      }

      const permission = await readWorkspaceTerminalPermission(this.client, this.cwd)
      const shell = resolveWorkspaceTerminalShell(server, permission)
      this.onShell(shell)
      this.lastSize = terminalSize
      this.emit({ state: 'running' })

      void requestTerminalRpc(this.client, 'command/exec', {
        command: shell.command,
        processId: this.processId,
        tty: true,
        cwd: this.cwd,
        size: terminalSize,
        env: { TERM: WORKSPACE_TERMINAL_TERM },
        ...(shell.permissionProfile ? { permissionProfile: shell.permissionProfile } : {}),
        disableTimeout: true,
        outputBytesCap: TERMINAL_OUTPUT_BYTES_CAP
      }).then((response) => {
        if (this.disposed || this.state === 'disconnected') {
          return
        }
        if (this.outputLimitReached) {
          this.closeConnection()
          return
        }
        this.emit({ state: 'exited', exitCode: response.exitCode })
        this.closeConnection()
      }).catch((error: unknown) => {
        if (this.disposed || this.state === 'disconnected' || this.state === 'error' || this.outputLimitReached) {
          return
        }
        this.emit({
          state: 'error',
          error: error instanceof Error ? error.message : 'Terminal process failed.'
        })
        this.closeConnection()
      })
    } catch (error) {
      if (!this.disposed) {
        this.emit({
          state: 'error',
          error: error instanceof Error ? error.message : 'Terminal connection failed.'
        })
        this.closeConnection()
      }
    }
  }

  writeText(value: string) {
    this.queueBytes(new TextEncoder().encode(value))
  }

  writeBinary(value: string) {
    this.queueBytes(encodeTerminalBinaryInput(value))
  }

  resize(size: { cols: number, rows: number }) {
    if (
      this.disposed
      || this.state !== 'running'
      || size.cols <= 0
      || size.rows <= 0
      || (this.lastSize?.cols === size.cols && this.lastSize.rows === size.rows)
    ) {
      return
    }

    this.lastSize = { ...size }
    void requestTerminalRpc(this.client, 'command/exec/resize', {
      processId: this.processId,
      size
    }).catch((error: unknown) => {
      if (!this.disposed && this.state === 'running') {
        this.emit({
          state: 'error',
          error: error instanceof Error ? error.message : 'Terminal resize failed.'
        })
        this.closeConnection()
      }
    })
  }

  async terminate() {
    if (this.disposed || !['starting', 'running', 'terminating', 'output-limit'].includes(this.state)) {
      return
    }

    if (!this.outputLimitReached && this.state !== 'terminating') {
      this.emit({ state: 'terminating' })
    }
    await this.requestTermination()
  }

  async dispose() {
    if (this.disposed) {
      return
    }

    const shouldTerminate = ['starting', 'running', 'terminating', 'output-limit'].includes(this.state)
    this.disposed = true

    try {
      if (shouldTerminate && this.connectedOnce) {
        await waitForTerminalCleanup(this.requestTermination())
      }
    } finally {
      this.closeConnection()
    }
  }

  private emit(event: WorkspaceTerminalEvent) {
    this.state = event.state
    this.onEvent(event)
  }

  private queueBytes(bytes: Uint8Array) {
    if (this.disposed || this.state !== 'running' || bytes.length === 0) {
      return
    }

    for (const chunk of chunkTerminalBytes(bytes)) {
      this.writeQueue = this.writeQueue.then(async () => {
        if (this.disposed || this.state !== 'running') {
          return
        }
        await requestTerminalRpc(this.client, 'command/exec/write', {
          processId: this.processId,
          deltaBase64: encodeTerminalBytes(chunk)
        })
      }).catch((error: unknown) => {
        if (!this.disposed && this.state === 'running') {
          this.emit({
            state: 'error',
            error: error instanceof Error ? error.message : 'Terminal input failed.'
          })
          this.closeConnection()
        }
      })
    }
  }

  private handleNotification(notification: CodexRpcNotification) {
    const output = asOutputDelta(notification)
    if (!output || output.processId !== this.processId || this.disposed || this.outputLimitReached) {
      return
    }

    this.onOutput(decodeTerminalBytes(output.deltaBase64))
    if (output.capReached && !this.outputLimitReached) {
      this.outputLimitReached = true
      this.emit({ state: 'output-limit' })
      void waitForTerminalCleanup(this.terminate()).finally(() => this.closeConnection())
    }
  }

  private handleConnectionState(state: CodexRpcConnectionState) {
    if (state === 'connected') {
      this.connectedOnce = true
      return
    }

    if (state === 'disconnected' && this.connectedOnce && !this.disposed && !['exited', 'error'].includes(this.state)) {
      this.emit({ state: 'disconnected' })
      this.closeConnection()
    }
  }

  private requestTermination() {
    if (!this.terminationPromise) {
      this.terminationPromise = requestTerminalRpc(this.client, 'command/exec/terminate', {
        processId: this.processId
      }).then(() => {})
    }
    return this.terminationPromise
  }

  private closeConnection() {
    if (this.connectionClosed) {
      return
    }

    this.connectionClosed = true
    this.releaseNotification?.()
    this.releaseConnectionState?.()
    this.releaseNotification = null
    this.releaseConnectionState = null
    this.client.close()
  }
}

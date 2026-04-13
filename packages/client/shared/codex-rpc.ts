type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

export type { ReasoningEffort } from './chat-prompt-controls'
import type { ReasoningEffort } from './chat-prompt-controls'

type JsonRpcRequest = {
  id: number
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  id: number
  result?: unknown
  error?: JsonRpcError
}

type JsonRpcNotification = {
  method: string
  params?: unknown
}

type JsonRpcServerRequest = JsonRpcRequest

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export type CodexUserInput =
  | {
      type: 'text'
      text: string
      text_elements: unknown[]
    }
  | {
      type: 'localImage'
      path: string
    }

export type CodexThreadItem =
  | {
      type: 'userMessage'
      id: string
      content: CodexUserInput[]
    }
  | {
      type: 'agentMessage'
      id: string
      text: string
    }
  | {
      type: 'plan'
      id: string
      text: string
    }
  | {
      type: 'reasoning'
      id: string
      summary: string[]
      content: string[]
    }
  | {
      type: 'commandExecution'
      id: string
      command: string
      aggregatedOutput: string | null
      exitCode: number | null
      status: string
    }
  | {
      type: 'fileChange'
      id: string
      changes: Array<{
        path: string
        kind?: unknown
        diff?: string | null
      }>
      status: string
    }
  | {
      type: 'mcpToolCall'
      id: string
      server: string
      tool: string
      arguments: unknown
      result: {
        content?: unknown[]
        structuredContent?: unknown
      } | null
      error: {
        message: string
      } | null
      status: string
    }
  | {
      type: 'dynamicToolCall'
      id: string
      tool: string
      arguments: unknown
      status: string
      contentItems: Array<{ type: 'inputText', text: string } | { type: 'inputImage', imageUrl: string }> | null
      success: boolean | null
    }
  | {
      type: 'collabAgentToolCall'
      id: string
      tool: 'spawnAgent' | 'sendInput' | 'resumeAgent' | 'wait' | 'closeAgent'
      status: string
      senderThreadId: string
      receiverThreadIds: string[]
      prompt: string | null
      model: string | null
      reasoningEffort: string | null
      agentsStates: Record<string, {
        status: 'pendingInit' | 'running' | 'interrupted' | 'completed' | 'errored' | 'shutdown' | 'notFound' | null
        message: string | null
      } | undefined>
    }
  | {
      type: 'webSearch'
      id: string
      query: string
      status?: string
    }
  | {
      type: 'contextCompaction'
      id: string
    }

export type CodexTurn = {
  id: string
  items: CodexThreadItem[]
  status: string
  error: {
    message: string
  } | null
}

export type CodexThread = {
  id: string
  preview: string
  cwd: string
  createdAt: number
  updatedAt: number
  name: string | null
  agentNickname?: string | null
  agentRole?: string | null
  turns: CodexTurn[]
}

export type InitializeResponse = {
  userAgent: string
  platformFamily: string
  platformOs: string
}

export type ThreadListResponse = {
  data: CodexThread[]
  nextCursor: string | null
}

export type ThreadStartResponse = {
  thread: CodexThread
  model?: string | null
  reasoningEffort?: ReasoningEffort | null
}

export type ThreadResumeResponse = {
  thread: CodexThread
  model?: string | null
  reasoningEffort?: ReasoningEffort | null
}

export type ThreadReadResponse = {
  thread: CodexThread
}

export type TurnStartResponse = {
  turn: {
    id: string
  }
}

export type ModelListResponse = {
  data?: unknown[]
}

export type ConfigReadResponse = {
  config?: {
    model?: string | null
    model_context_window?: number | string | null
    model_reasoning_effort?: ReasoningEffort | null
  } | null
}

export type CodexRpcNotification = {
  method: string
  params?: unknown
}

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const asError = (value: unknown) =>
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : 'Unknown RPC error.')

const toServerRequestResponse = async (request: JsonRpcServerRequest) => {
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' }
    case 'item/permissions/requestApproval':
      return { permissions: {}, scope: 'turn' }
    case 'item/tool/requestUserInput':
      return { answers: {} }
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null, _meta: null }
    case 'applyPatchApproval':
    case 'execCommandApproval':
      return { decision: 'denied' }
    default:
      return null
  }
}

export const notificationThreadId = (notification: CodexRpcNotification) => {
  const params = isObjectRecord(notification.params) ? notification.params : null
  const directThreadId = params?.threadId
  if (typeof directThreadId === 'string') {
    return directThreadId
  }

  const thread = isObjectRecord(params?.thread) ? params.thread : null
  if (typeof thread?.id === 'string') {
    return thread.id
  }

  return null
}

export const notificationTurnId = (notification: CodexRpcNotification) => {
  const params = isObjectRecord(notification.params) ? notification.params : null

  const directTurnId = params?.turnId
  if (typeof directTurnId === 'string') {
    return directTurnId
  }

  const turn = isObjectRecord(params?.turn) ? params?.turn : null
  if (typeof turn?.id === 'string') {
    return turn.id
  }

  return null
}

export const notificationThreadName = (notification: CodexRpcNotification) => {
  const params = isObjectRecord(notification.params) ? notification.params : null
  const thread = isObjectRecord(params?.thread) ? params.thread : null
  const directName = thread?.name ?? params?.name ?? params?.title

  return typeof directName === 'string' ? directName : null
}

export const notificationThreadUpdatedAt = (notification: CodexRpcNotification) => {
  const params = isObjectRecord(notification.params) ? notification.params : null
  const thread = isObjectRecord(params?.thread) ? params.thread : null
  const directUpdatedAt = thread?.updatedAt ?? params?.updatedAt

  return typeof directUpdatedAt === 'number' ? directUpdatedAt : undefined
}

export class CodexRpcClient {
  private readonly url: string

  private socket: WebSocket | null = null

  private connectPromise: Promise<void> | null = null

  private initialized = false

  private nextRequestId = 1

  private pending = new Map<number, PendingRequest>()

  private listeners = new Set<(notification: CodexRpcNotification) => void>()

  constructor(url: string) {
    this.url = url
  }

  subscribe(listener: (notification: CodexRpcNotification) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async connect() {
    if (this.initialized && this.socket?.readyState === WebSocket.OPEN) {
      return
    }

    if (this.connectPromise) {
      return await this.connectPromise
    }

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(this.url)
      this.socket = socket

      const cleanup = () => {
        socket.removeEventListener('open', handleOpen)
        socket.removeEventListener('error', handleError)
      }

      const handleError = () => {
        cleanup()
        reject(new Error(`Failed to connect to ${this.url}`))
      }

      const handleOpen = async () => {
        cleanup()

        try {
          await this.sendRequestNow<InitializeResponse>('initialize', {
            clientInfo: {
              name: '@codori/client',
              title: 'Codori Client',
              version: '0.1.0'
            },
            capabilities: {
              experimentalApi: true,
              optOutNotificationMethods: null
            }
          })
          this.sendNotificationNow('initialized')
          this.initialized = true
          resolve()
        } catch (error) {
          reject(asError(error))
        }
      }

      socket.addEventListener('open', handleOpen, { once: true })
      socket.addEventListener('error', handleError, { once: true })
      socket.addEventListener('message', event => {
        void this.handleMessage(event.data)
      })
      socket.addEventListener('close', () => {
        this.initialized = false
        this.socket = null
        this.connectPromise = null
        const error = new Error('Codex RPC connection closed.')
        for (const [requestId, pending] of this.pending.entries()) {
          pending.reject(error)
          this.pending.delete(requestId)
        }
      }, { once: true })
    }).finally(() => {
      if (!this.initialized) {
        this.connectPromise = null
      }
    })

    return await this.connectPromise
  }

  async request<T>(method: string, params?: unknown) {
    await this.connect()
    return await this.sendRequestNow<T>(method, params)
  }

  close() {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) {
      this.socket.close()
    }
  }

  private async handleMessage(raw: unknown) {
    const payload = await this.parsePayload(raw)
    if (!payload) {
      return
    }

    if ('id' in payload && 'method' in payload) {
      const result = await toServerRequestResponse(payload)
      this.sendRaw({
        id: payload.id,
        result
      })
      return
    }

    if ('id' in payload) {
      const pending = this.pending.get(payload.id)
      if (!pending) {
        return
      }

      this.pending.delete(payload.id)

      if (payload.error) {
        pending.reject(new Error(payload.error.message))
        return
      }

      pending.resolve(payload.result)
      return
    }

    for (const listener of this.listeners) {
      listener(payload)
    }
  }

  private async parsePayload(raw: unknown): Promise<JsonRpcResponse | JsonRpcNotification | JsonRpcServerRequest | null> {
    const text = typeof raw === 'string'
      ? raw
      : raw instanceof ArrayBuffer
        ? new TextDecoder().decode(raw)
        : raw instanceof Blob
          ? await raw.text()
          : null
    if (!text) {
      return null
    }

    try {
      const parsed = JSON.parse(text) as unknown
      if (!isObjectRecord(parsed)) {
        return null
      }

      if (typeof parsed.id === 'number' && typeof parsed.method === 'string') {
        return parsed as JsonRpcServerRequest
      }

      if (typeof parsed.id === 'number') {
        return parsed as JsonRpcResponse
      }

      if (typeof parsed.method === 'string') {
        return parsed as JsonRpcNotification
      }

      return null
    } catch {
      return null
    }
  }

  private async sendRequestNow<T>(method: string, params?: unknown): Promise<T> {
    const requestId = this.nextRequestId
    this.nextRequestId += 1

    const payload: JsonRpcRequest = {
      id: requestId,
      method
    }

    if (params !== undefined) {
      payload.params = params
    }

    return await new Promise<T>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: value => resolve(value as T),
        reject
      })

      try {
        this.sendRaw(payload)
      } catch (error) {
        this.pending.delete(requestId)
        reject(asError(error))
      }
    })
  }

  private sendNotificationNow(method: string, params?: unknown) {
    const payload: JsonRpcNotification = { method }
    if (params !== undefined) {
      payload.params = params
    }

    this.sendRaw(payload)
  }

  private sendRaw(payload: JsonRpcRequest | JsonRpcResponse | JsonRpcNotification) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Codex RPC socket is not open.')
    }

    this.socket.send(JSON.stringify(payload))
  }
}

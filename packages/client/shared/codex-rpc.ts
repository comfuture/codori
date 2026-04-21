type JsonRpcError = {
  code: number
  message: string
  data?: unknown
}

import type { ItemCompletedNotification as GeneratedItemCompletedNotification } from './generated/codex-app-server/v2/ItemCompletedNotification'
import type { ItemStartedNotification as GeneratedItemStartedNotification } from './generated/codex-app-server/v2/ItemStartedNotification'
import type { PlanDeltaNotification as GeneratedPlanDeltaNotification } from './generated/codex-app-server/v2/PlanDeltaNotification'
import type { ServerRequestResolvedNotification as GeneratedServerRequestResolvedNotification } from './generated/codex-app-server/v2/ServerRequestResolvedNotification'
import type { ThreadItem as GeneratedThreadItem } from './generated/codex-app-server/v2/ThreadItem'
import type { TurnCompletedNotification as GeneratedTurnCompletedNotification } from './generated/codex-app-server/v2/TurnCompletedNotification'
import type { TurnPlanUpdatedNotification as GeneratedTurnPlanUpdatedNotification } from './generated/codex-app-server/v2/TurnPlanUpdatedNotification'
import type { TurnStatus as GeneratedTurnStatus } from './generated/codex-app-server/v2/TurnStatus'
import type { UserInput as GeneratedUserInput } from './generated/codex-app-server/v2/UserInput'
export type { ReasoningEffort } from './chat-prompt-controls'
import type { ReasoningEffort } from './chat-prompt-controls'

type JsonRpcId = string | number

type JsonRpcRequest = {
  id: JsonRpcId
  method: string
  params?: unknown
}

type JsonRpcResponse = {
  id: JsonRpcId
  result?: unknown
  error?: JsonRpcError
}

type JsonRpcNotification = {
  method: string
  params?: unknown
}

export type CodexRpcServerRequest = JsonRpcRequest

type JsonRpcServerRequest = CodexRpcServerRequest

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

export type CodexRpcServerRequestHandler = (request: CodexRpcServerRequest) => Promise<unknown> | unknown

export type CodexUserInput = GeneratedUserInput

export type CodexThreadItem = GeneratedThreadItem

export type CodexTurn = {
  id: string
  items: CodexThreadItem[]
  status: GeneratedTurnStatus
  error: {
    message: string
  } | null
  startedAt?: number | null
  completedAt?: number | null
  durationMs?: number | null
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

export type ReviewTarget =
  | {
      type: 'uncommittedChanges'
    }
  | {
      type: 'baseBranch'
      branch: string
    }
  | {
      type: 'commit'
      sha: string
      title?: string | null
    }
  | {
      type: 'custom'
      instructions: string
    }

export type ReviewDelivery = 'inline' | 'detached'

export type ReviewStartParams = {
  threadId: string
  delivery?: ReviewDelivery
  target: ReviewTarget
}

export type ReviewStartResponse = {
  reviewThreadId: string
  turn: CodexTurn
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

const isGeneratedTurnStatus = (value: unknown): value is GeneratedTurnStatus =>
  value === 'completed'
  || value === 'interrupted'
  || value === 'failed'
  || value === 'inProgress'

const asNotificationParams = <T>(
  notification: CodexRpcNotification,
  method: string
): Partial<T> | null =>
  notification.method === method && isObjectRecord(notification.params)
    ? notification.params as Partial<T>
    : null

const asError = (value: unknown) =>
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : 'Unknown RPC error.')

const isJsonRpcId = (value: unknown): value is JsonRpcId =>
  typeof value === 'number' || typeof value === 'string'

export const toServerRequestResponse = async (
  request: JsonRpcServerRequest,
  options?: {
    handler?: CodexRpcServerRequestHandler | null
  }
) => {
  switch (request.method) {
    case 'item/commandExecution/requestApproval':
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' }
    case 'item/permissions/requestApproval':
      return { permissions: {}, scope: 'turn' }
    case 'item/tool/requestUserInput':
      if (options?.handler) {
        const handled = await options.handler(request)
        if (handled != null) {
          return handled
        }
      }
      return { answers: {} }
    case 'mcpServer/elicitation/request':
      if (options?.handler) {
        const handled = await options.handler(request)
        if (handled != null) {
          return handled
        }
      }
      return { action: 'decline', content: null, _meta: null }
    case 'applyPatchApproval':
    case 'execCommandApproval':
      return { decision: 'denied' }
    default:
      return null
  }
}

export const notificationThreadId = (notification: CodexRpcNotification) => {
  const resolvedRequest = asNotificationParams<GeneratedServerRequestResolvedNotification>(notification, 'serverRequest/resolved')
  if (typeof resolvedRequest?.threadId === 'string') {
    return resolvedRequest.threadId
  }

  const planDelta = asNotificationParams<GeneratedPlanDeltaNotification>(notification, 'item/plan/delta')
  if (typeof planDelta?.threadId === 'string') {
    return planDelta.threadId
  }

  const planUpdated = asNotificationParams<GeneratedTurnPlanUpdatedNotification>(notification, 'turn/plan/updated')
  if (typeof planUpdated?.threadId === 'string') {
    return planUpdated.threadId
  }

  const itemStarted = asNotificationParams<GeneratedItemStartedNotification>(notification, 'item/started')
  if (typeof itemStarted?.threadId === 'string') {
    return itemStarted.threadId
  }

  const itemCompleted = asNotificationParams<GeneratedItemCompletedNotification>(notification, 'item/completed')
  if (typeof itemCompleted?.threadId === 'string') {
    return itemCompleted.threadId
  }

  const turnCompleted = asNotificationParams<GeneratedTurnCompletedNotification>(notification, 'turn/completed')
  if (typeof turnCompleted?.threadId === 'string') {
    return turnCompleted.threadId
  }

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
  const planDelta = asNotificationParams<GeneratedPlanDeltaNotification>(notification, 'item/plan/delta')
  if (typeof planDelta?.turnId === 'string') {
    return planDelta.turnId
  }

  const planUpdated = asNotificationParams<GeneratedTurnPlanUpdatedNotification>(notification, 'turn/plan/updated')
  if (typeof planUpdated?.turnId === 'string') {
    return planUpdated.turnId
  }

  const itemStarted = asNotificationParams<GeneratedItemStartedNotification>(notification, 'item/started')
  if (typeof itemStarted?.turnId === 'string') {
    return itemStarted.turnId
  }

  const itemCompleted = asNotificationParams<GeneratedItemCompletedNotification>(notification, 'item/completed')
  if (typeof itemCompleted?.turnId === 'string') {
    return itemCompleted.turnId
  }

  const turnCompleted = asNotificationParams<GeneratedTurnCompletedNotification>(notification, 'turn/completed')
  if (turnCompleted?.turn && typeof turnCompleted.turn === 'object' && typeof turnCompleted.turn.id === 'string') {
    return turnCompleted.turn.id
  }

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

export const notificationRequestId = (notification: CodexRpcNotification) => {
  const resolvedRequest = asNotificationParams<GeneratedServerRequestResolvedNotification>(notification, 'serverRequest/resolved')
  if (typeof resolvedRequest?.requestId === 'string' || typeof resolvedRequest?.requestId === 'number') {
    return resolvedRequest.requestId
  }

  const params = isObjectRecord(notification.params) ? notification.params : null
  const directRequestId = params?.requestId

  return isJsonRpcId(directRequestId) ? directRequestId : null
}

export const notificationTurnStatus = (notification: CodexRpcNotification): GeneratedTurnStatus | null => {
  const turnCompleted = asNotificationParams<GeneratedTurnCompletedNotification>(notification, 'turn/completed')
  if (turnCompleted?.turn && typeof turnCompleted.turn === 'object' && isGeneratedTurnStatus(turnCompleted.turn.status)) {
    return turnCompleted.turn.status
  }

  const params = isObjectRecord(notification.params) ? notification.params : null
  const directStatus = params?.status
  if (isGeneratedTurnStatus(directStatus)) {
    return directStatus
  }

  const turn = isObjectRecord(params?.turn) ? params.turn : null
  return isGeneratedTurnStatus(turn?.status) ? turn.status : null
}

export class CodexRpcClient {
  private readonly url: string

  private socket: WebSocket | null = null

  private connectPromise: Promise<void> | null = null

  private initialized = false

  private nextRequestId = 1

  private pending = new Map<JsonRpcId, PendingRequest>()

  private listeners = new Set<(notification: CodexRpcNotification) => void>()

  private serverRequestHandler: CodexRpcServerRequestHandler | null = null

  constructor(url: string) {
    this.url = url
  }

  subscribe(listener: (notification: CodexRpcNotification) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  setServerRequestHandler(handler: CodexRpcServerRequestHandler | null) {
    this.serverRequestHandler = handler

    return () => {
      if (this.serverRequestHandler === handler) {
        this.serverRequestHandler = null
      }
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
              version: '0.1.1'
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
      const result = await toServerRequestResponse(payload, {
        handler: this.serverRequestHandler
      })
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

      if (isJsonRpcId(parsed.id) && typeof parsed.method === 'string') {
        return parsed as JsonRpcServerRequest
      }

      if (isJsonRpcId(parsed.id)) {
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

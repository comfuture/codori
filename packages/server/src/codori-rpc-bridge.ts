import { randomUUID } from 'node:crypto'
import net from 'node:net'
import { join } from 'node:path'
import WebSocket from 'ws'
import {
  ServerAvatarResolver,
  type ResolvedServerAvatar
} from './server-avatar.js'
import type {
  AppServerTarget,
  RuntimeBridgeTarget
} from './types.js'
import {
  UnixJsonlTransport,
  type UnixJsonlPayload
} from './unix-jsonl-transport.js'

type JsonRpcId = string | number

type JsonRpcMessage = {
  id?: unknown
  method?: unknown
  params?: unknown
  result?: unknown
  error?: unknown
}

type PendingInternalRequest = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

type QueuedFrame = {
  message: WebSocket.RawData
  isBinary: boolean
}

type RpcPayload = WebSocket.RawData | string

type RpcUpstream = {
  isOpen: () => boolean
  isConnecting: () => boolean
  send: (message: RpcPayload, isBinary?: boolean) => void
  close: () => void
}

export type CodoriRpcBridgeOptions = {
  clientSocket: WebSocket
  startRuntime: () => Promise<RuntimeBridgeTarget>
  touchActivity: () => void
  releaseSession: () => void
  avatarResolver: ServerAvatarResolver
  invalidateTarget?: (target: AppServerTarget) => void
}

const INTERNAL_REQUEST_TIMEOUT_MS = 10_000
const INTERNAL_ID_PREFIX = '__codori_internal__'
const AVATAR_CHANGED_DEBOUNCE_MS = 100

const isJsonRpcId = (value: unknown): value is JsonRpcId =>
  typeof value === 'string' || typeof value === 'number'

const rawDataToText = (value: WebSocket.RawData) => {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof ArrayBuffer) {
    return Buffer.from(value).toString('utf8')
  }
  if (Array.isArray(value)) {
    return Buffer.concat(value).toString('utf8')
  }
  return value.toString('utf8')
}

const parseJsonRpc = (message: WebSocket.RawData, isBinary: boolean): JsonRpcMessage | null => {
  if (isBinary) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(rawDataToText(message))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as JsonRpcMessage
      : null
  } catch {
    return null
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null

const canConnectToPort = (port: number) =>
  new Promise<boolean>((resolvePromise) => {
    const socket = net.createConnection({
      host: '127.0.0.1',
      port
    })
    const finish = (ready: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolvePromise(ready)
    }
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.setTimeout(250, () => finish(false))
  })

const waitForPortReady = async (port: number, attempts = 80, delayMs = 100) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await canConnectToPort(port)) {
      return true
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, delayMs))
  }
  return false
}

class CodoriAvatarRpcExtension {
  private readonly clientSocket: WebSocket
  private readonly upstream: RpcUpstream
  private readonly resolver: ServerAvatarResolver
  private readonly workspacePath: string | null
  private readonly internalPrefix = `${INTERNAL_ID_PREFIX}:${randomUUID()}:`
  private readonly pendingInternal = new Map<string, PendingInternalRequest>()
  private readonly ownedWatchIds = new Set<string>()
  private initializeRequestId: JsonRpcId | null = null
  private initialized = false
  private initializeResponse: {
    codexHome: string
    userAgent: string
  } | null = null
  private resolvedAvatar: ResolvedServerAvatar | null = null
  private watchRequested = false
  private watchCounter = 0
  private changedTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: {
    clientSocket: WebSocket
    upstream: RpcUpstream
    avatarResolver: ServerAvatarResolver
    workspacePath: string | null
  }) {
    this.clientSocket = options.clientSocket
    this.upstream = options.upstream
    this.resolver = options.avatarResolver
    this.workspacePath = options.workspacePath
  }

  handleClientMessage(message: WebSocket.RawData, isBinary: boolean) {
    const payload = parseJsonRpc(message, isBinary)
    if (!payload) {
      return false
    }

    if (
      typeof payload.id === 'string'
      && payload.id.startsWith(INTERNAL_ID_PREFIX)
    ) {
      this.sendError(payload.id, -32600, 'Reserved JSON-RPC request id.')
      return true
    }

    if (
      payload.method === 'initialize'
      && isJsonRpcId(payload.id)
    ) {
      this.initializeRequestId = payload.id
      return false
    }
    if (payload.method === 'initialized') {
      this.initialized = this.initializeResponse !== null
      return false
    }

    if (typeof payload.method !== 'string' || !payload.method.startsWith('codori/')) {
      return false
    }
    if (!isJsonRpcId(payload.id)) {
      return true
    }

    void this.handleCodoriRequest(payload.id, payload.method, payload.params)
    return true
  }

  handleUpstreamMessage(message: WebSocket.RawData, isBinary: boolean) {
    const payload = parseJsonRpc(message, isBinary)
    if (!payload) {
      return false
    }

    if (typeof payload.id === 'string' && this.pendingInternal.has(payload.id)) {
      const pending = this.pendingInternal.get(payload.id)!
      this.pendingInternal.delete(payload.id)
      clearTimeout(pending.timer)
      const error = asRecord(payload.error)
      if (error) {
        pending.reject(new Error(
          typeof error.message === 'string' ? error.message : 'Internal app-server request failed.'
        ))
      } else {
        pending.resolve(payload.result)
      }
      return true
    }

    if (payload.id === this.initializeRequestId) {
      const result = asRecord(payload.result)
      if (
        result
        && typeof result.codexHome === 'string'
        && typeof result.userAgent === 'string'
      ) {
        this.initializeResponse = {
          codexHome: result.codexHome,
          userAgent: result.userAgent
        }
      }
      return false
    }

    if (payload.method === 'fs/changed') {
      const params = asRecord(payload.params)
      const watchId = params?.watchId
      if (typeof watchId === 'string' && this.ownedWatchIds.has(watchId)) {
        this.scheduleAvatarChanged()
        return true
      }
    }

    return false
  }

  dispose() {
    if (this.changedTimer) {
      clearTimeout(this.changedTimer)
      this.changedTimer = null
    }
    for (const [requestId, pending] of this.pendingInternal.entries()) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Codori RPC bridge closed.'))
      this.pendingInternal.delete(requestId)
    }
    // App-server watches are connection-scoped and are released when the
    // upstream transport closes. Avoid creating new pending requests while
    // this extension is being torn down.
    this.ownedWatchIds.clear()
  }

  private async handleCodoriRequest(
    id: JsonRpcId,
    method: string,
    params: unknown
  ) {
    if (!this.initialized || !this.initializeResponse) {
      this.sendError(id, -32001, 'Codori extensions require an initialized app-server connection.')
      return
    }

    try {
      switch (method) {
        case 'codori/avatar/read': {
          const avatar = await this.readAvatar()
          this.sendResult(id, { avatar: avatar.metadata })
          return
        }
        case 'codori/avatar/sprites': {
          const request = asRecord(params)
          if (
            !request
            || typeof request.avatarId !== 'string'
            || typeof request.revision !== 'string'
          ) {
            this.sendError(id, -32602, 'Invalid avatar sprites request.')
            return
          }
          const avatar = this.resolvedAvatar
          if (
            !avatar
            || avatar.metadata.avatarId !== request.avatarId
            || avatar.metadata.revision !== request.revision
          ) {
            this.sendError(id, -32004, 'Avatar revision is unavailable. Read the avatar again.')
            return
          }
          this.sendResult(id, {
            avatarId: avatar.metadata.avatarId,
            revision: avatar.metadata.revision,
            mimeType: avatar.metadata.mimeType,
            data: avatar.bytes.toString('base64')
          })
          return
        }
        case 'codori/avatar/watch': {
          this.watchRequested = true
          await this.readAvatar()
          this.sendResult(id, { watching: this.ownedWatchIds.size > 0 })
          return
        }
        case 'codori/avatar/unwatch': {
          this.watchRequested = false
          await this.unwatchAll()
          this.sendResult(id, { watching: false })
          return
        }
        default:
          this.sendError(id, -32601, `Unknown Codori method: ${method}`)
      }
    } catch {
      this.sendError(id, -32050, 'The selected server avatar is temporarily unavailable.')
    }
  }

  private async readAvatar() {
    const codexHome = this.initializeResponse!.codexHome
    const response = asRecord(await this.requestInternal('config/read', {
      includeLayers: false,
      cwd: this.workspacePath
    }))
    const config = asRecord(response?.config)
    const desktop = asRecord(config?.desktop)
    const selectedAvatarId = typeof desktop?.['selected-avatar-id'] === 'string'
      ? desktop['selected-avatar-id']
      : null
    const avatar = await this.resolver.resolve(codexHome, selectedAvatarId)
    this.resolvedAvatar = avatar
    if (this.watchRequested) {
      await this.refreshWatches(avatar)
    }
    return avatar
  }

  private requestInternal(method: string, params?: unknown) {
    if (!this.upstream.isOpen()) {
      return Promise.reject(new Error('Upstream app-server is unavailable.'))
    }
    const id = `${this.internalPrefix}${this.pendingInternal.size + 1}:${randomUUID()}`
    return new Promise<unknown>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        this.pendingInternal.delete(id)
        reject(new Error('Internal app-server request timed out.'))
      }, INTERNAL_REQUEST_TIMEOUT_MS)
      this.pendingInternal.set(id, {
        resolve: resolvePromise,
        reject,
        timer
      })
      this.upstream.send(JSON.stringify({
        id,
        method,
        ...(params === undefined ? {} : { params })
      }))
    })
  }

  private async refreshWatches(avatar: ResolvedServerAvatar) {
    await this.unwatchAll()
    const paths = [
      join(this.initializeResponse!.codexHome, 'config.toml'),
      avatar.watchPath
    ].filter((path): path is string => Boolean(path))
    let watchesStarted = 0
    for (const path of paths) {
      const watchId = `${this.internalPrefix}avatar-watch:${++this.watchCounter}`
      try {
        await this.requestInternal('fs/watch', { watchId, path })
        this.ownedWatchIds.add(watchId)
        watchesStarted += 1
      } catch {
        // Older app-server versions may not support filesystem watches.
        // Avatar reads remain usable and the next reconnect/read refreshes state.
      }
    }
    return watchesStarted > 0
  }

  private async unwatchAll() {
    const watchIds = [...this.ownedWatchIds]
    this.ownedWatchIds.clear()
    await Promise.all(watchIds.map(watchId =>
      this.requestInternal('fs/unwatch', { watchId }).catch(() => {})
    ))
  }

  private scheduleAvatarChanged() {
    if (this.changedTimer) {
      clearTimeout(this.changedTimer)
    }
    this.changedTimer = setTimeout(() => {
      this.changedTimer = null
      const codexHome = this.initializeResponse?.codexHome
      if (!codexHome) {
        return
      }
      this.resolver.invalidate(codexHome)
      this.resolvedAvatar = null
      void this.unwatchAll()
      if (this.clientSocket.readyState === WebSocket.OPEN) {
        this.clientSocket.send(JSON.stringify({
          method: 'codori/avatar/changed',
          params: {
            serverId: this.resolver.serverId(codexHome)
          }
        }))
      }
    }, AVATAR_CHANGED_DEBOUNCE_MS)
  }

  private sendResult(id: JsonRpcId, result: unknown) {
    if (this.clientSocket.readyState === WebSocket.OPEN) {
      this.clientSocket.send(JSON.stringify({ id, result }))
    }
  }

  private sendError(id: JsonRpcId, code: number, message: string) {
    if (this.clientSocket.readyState === WebSocket.OPEN) {
      this.clientSocket.send(JSON.stringify({
        id,
        error: { code, message }
      }))
    }
  }
}

export const bridgeCodexRpcWebSocket = (options: CodoriRpcBridgeOptions) => {
  const queuedClientFrames: QueuedFrame[] = []
  let upstream: RpcUpstream | null = null
  let extension: CodoriAvatarRpcExtension | null = null
  let sessionReleased = false
  let selectedTarget: AppServerTarget | null = null
  let targetInvalidated = false

  const releaseSession = () => {
    if (sessionReleased) {
      return
    }
    sessionReleased = true
    options.releaseSession()
  }

  const closeBoth = (code = 1011, reason = 'proxy error') => {
    extension?.dispose()
    if (
      options.clientSocket.readyState === WebSocket.OPEN
      || options.clientSocket.readyState === WebSocket.CONNECTING
    ) {
      options.clientSocket.close(code, reason)
    }
    if (
      upstream
      && (upstream.isOpen() || upstream.isConnecting())
    ) {
      upstream.close()
    }
  }

  const invalidateSelectedTarget = () => {
    if (!selectedTarget || targetInvalidated) {
      return
    }
    targetInvalidated = true
    options.invalidateTarget?.(selectedTarget)
  }

  const forwardClientFrame = (frame: QueuedFrame) => {
    if (!upstream || !upstream.isOpen()) {
      queuedClientFrames.push(frame)
      return
    }
    if (extension?.handleClientMessage(frame.message, frame.isBinary)) {
      return
    }
    upstream.send(frame.message, frame.isBinary)
  }

  options.clientSocket.on('message', (message: WebSocket.RawData, isBinary: boolean) => {
    options.touchActivity()
    forwardClientFrame({ message, isBinary })
  })

  options.clientSocket.on('error', () => {
    closeBoth(1011, 'client websocket failed')
  })

  options.clientSocket.on('close', () => {
    extension?.dispose()
    releaseSession()
    if (
      upstream
      && (upstream.isOpen() || upstream.isConnecting())
    ) {
      upstream.close()
    }
  })

  void (async () => {
    const bridgeTarget = await options.startRuntime()
    const target = bridgeTarget.target
    selectedTarget = target
    if (target.transport === 'tcp-websocket') {
      const ready = await waitForPortReady(target.port)
      if (!ready) {
        invalidateSelectedTarget()
        closeBoth(1011, 'runtime did not become ready')
        return
      }
    }
    if (
      options.clientSocket.readyState !== WebSocket.OPEN
      && options.clientSocket.readyState !== WebSocket.CONNECTING
    ) {
      releaseSession()
      return
    }

    const handleUpstreamOpen = () => {
      if (options.clientSocket.readyState !== WebSocket.OPEN) {
        upstream?.close()
        return
      }
      extension = new CodoriAvatarRpcExtension({
        clientSocket: options.clientSocket,
        upstream: upstream!,
        avatarResolver: options.avatarResolver,
        workspacePath: bridgeTarget.workspacePath
      })
      for (const frame of queuedClientFrames.splice(0, queuedClientFrames.length)) {
        forwardClientFrame(frame)
      }
    }
    const handleUpstreamMessage = (
      message: WebSocket.RawData,
      isBinary: boolean
    ) => {
      options.touchActivity()
      if (extension?.handleUpstreamMessage(message, isBinary)) {
        return
      }
      if (options.clientSocket.readyState === WebSocket.OPEN) {
        options.clientSocket.send(message, { binary: isBinary })
      }
    }
    const handleUpstreamError = () => {
      invalidateSelectedTarget()
      closeBoth(1011, 'upstream transport failed')
    }
    const handleUpstreamClose = () => {
      extension?.dispose()
      if (
        options.clientSocket.readyState === WebSocket.OPEN
        || options.clientSocket.readyState === WebSocket.CONNECTING
      ) {
        invalidateSelectedTarget()
        options.clientSocket.close()
      }
    }

    if (target.transport === 'unix-socket') {
      const transport = new UnixJsonlTransport(target.socketPath, {
        open: handleUpstreamOpen,
        message: message => handleUpstreamMessage(message, false),
        error: handleUpstreamError,
        close: handleUpstreamClose
      })
      upstream = {
        isOpen: () => transport.isOpen(),
        isConnecting: () => transport.isConnecting(),
        send: message => transport.send(message as UnixJsonlPayload),
        close: () => transport.close()
      }
    } else {
      const socket = new WebSocket(`ws://127.0.0.1:${target.port}`)
      upstream = {
        isOpen: () => socket.readyState === WebSocket.OPEN,
        isConnecting: () => socket.readyState === WebSocket.CONNECTING,
        send: (message, isBinary = false) => {
          socket.send(message, { binary: isBinary })
        },
        close: () => socket.close()
      }
      socket.once('open', handleUpstreamOpen)
      socket.on('message', handleUpstreamMessage)
      socket.on('error', handleUpstreamError)
      socket.on('close', handleUpstreamClose)
    }
  })().catch(() => {
    closeBoth(1011, 'upstream bootstrap failed')
  })
}

import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import { createUnixWebSocket } from './unix-websocket.js'
import type { AppServerTarget } from './types.js'

const REQUEST_TIMEOUT_MS = 10_000

type JsonRpcResponse = {
  id?: unknown
  result?: unknown
  error?: { message?: unknown }
}

const connect = (target: AppServerTarget) => target.kind === 'codex-daemon'
  ? createUnixWebSocket(target.socketPath)
  : new WebSocket(`ws://127.0.0.1:${target.port}`)

const asResponse = (raw: WebSocket.RawData): JsonRpcResponse | null => {
  try {
    const parsed: unknown = JSON.parse(raw.toString())
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as JsonRpcResponse
      : null
  } catch {
    return null
  }
}

/**
 * Makes one short-lived, initialized app-server request. Project management and
 * server filesystem browsing must run where Codex runs; they are deliberately
 * not proxied through the browser's filesystem APIs.
 */
export const requestAppServer = async <T>(
  target: AppServerTarget,
  method: string,
  params: unknown = {}
): Promise<T> => await new Promise<T>((resolve, reject) => {
  const socket = connect(target)
  const initializeId = `codori-project-init:${randomUUID()}`
  const requestId = `codori-project-request:${randomUUID()}`
  let settled = false

  const finish = (callback: () => void) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    socket.removeAllListeners()
    socket.close()
    callback()
  }

  const timer = setTimeout(() => finish(() => reject(new Error(
    `Timed out waiting for app-server ${method}.`
  ))), REQUEST_TIMEOUT_MS)

  socket.once('error', error => finish(() => reject(error)))
  socket.once('close', () => finish(() => reject(new Error(
    `The app-server connection closed before responding to ${method}.`
  ))))
  socket.once('open', () => {
    socket.send(JSON.stringify({
      id: initializeId,
      method: 'initialize',
      params: {
        clientInfo: { name: 'codori', version: '0.0.0' },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: null
        }
      }
    }))
  })
  socket.on('message', raw => {
    const response = asResponse(raw)
    if (!response) return
    if (response.id === initializeId) {
      if (response.error) {
        finish(() => reject(new Error(String(response.error?.message ?? 'App-server initialization failed.'))))
        return
      }
      socket.send(JSON.stringify({ method: 'initialized' }))
      socket.send(JSON.stringify({ id: requestId, method, params }))
      return
    }
    if (response.id !== requestId) return
    if (response.error) {
      finish(() => reject(new Error(String(response.error?.message ?? `App-server ${method} failed.`))))
      return
    }
    finish(() => resolve(response.result as T))
  })
})

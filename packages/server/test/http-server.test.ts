import { createServer as createNetServer } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { createHttpServer, type RuntimeManagerLike } from '../src/http-server.js'
import type { ProjectStatusRecord, StartProjectResult } from '../src/types.js'

const startedApps: Array<Awaited<ReturnType<typeof createHttpServer>>> = []
const startedSocketServers: WebSocketServer[] = []
const occupiedTcpServers: Array<ReturnType<typeof createNetServer>> = []

afterEach(async () => {
  for (const app of startedApps.splice(0, startedApps.length)) {
    await app.close()
  }

  for (const server of startedSocketServers.splice(0, startedSocketServers.length)) {
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      })
    })
  }

  for (const server of occupiedTcpServers.splice(0, occupiedTcpServers.length)) {
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error?: Error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      })
    })
  }
})

const createProjectRecord = (): ProjectStatusRecord => ({
  projectId: 'demo',
  projectPath: '/tmp/demo',
  status: 'running',
  pid: 123,
  port: 46000,
  startedAt: 1,
  error: null
})

const createManager = (overrides: Partial<RuntimeManagerLike> = {}): RuntimeManagerLike => ({
  listProjectStatuses: () => [createProjectRecord()],
  getProjectStatus: () => createProjectRecord(),
  startProject: () => ({
    ...createProjectRecord(),
    reusedExisting: true
  }),
  stopProject: () => ({
    ...createProjectRecord(),
    status: 'stopped',
    pid: null,
    port: null,
    startedAt: null
  }),
  ...overrides
})

const rawDataToString = (value: WebSocket.RawData) => {
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

describe('createHttpServer', () => {
  it('serves project management routes', async () => {
    const app = await createHttpServer(createManager())
    startedApps.push(app)

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/projects'
    })
    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toEqual({
      projects: [createProjectRecord()]
    })

    const startResponse = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/start'
    })
    expect(startResponse.statusCode).toBe(200)
    expect(startResponse.json()).toEqual({
      project: {
        ...createProjectRecord(),
        reusedExisting: true
      }
    })
  })

  it('bridges websocket frames to the project app-server', async () => {
    const tcpServer = createNetServer()
    await new Promise<void>((resolvePromise, reject) => {
      tcpServer.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      })
    })
    const address = tcpServer.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get test server address.')
    }
    const backendPort = address.port
    await new Promise<void>((resolvePromise, reject) => {
      tcpServer.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      })
    })

    const backend = new WebSocketServer({
      host: '127.0.0.1',
      port: backendPort
    })
    startedSocketServers.push(backend)
    await new Promise<void>((resolvePromise) => {
      backend.once('listening', () => {
        resolvePromise()
      })
    })
    backend.on('connection', (socket: WebSocket) => {
      socket.on('message', (message: WebSocket.RawData) => {
        socket.send(rawDataToString(message).toUpperCase())
      })
    })

    const manager = createManager({
      startProject: () => ({
        ...createProjectRecord(),
        port: backendPort,
        reusedExisting: true
      } satisfies StartProjectResult)
    })
    const app = await createHttpServer(manager)
    startedApps.push(app)
    await app.listen({
      host: '127.0.0.1',
      port: 0
    })

    const serverAddress = app.addresses()[0]
    const client = new WebSocket(`ws://127.0.0.1:${serverAddress.port}/api/projects/demo/rpc`)

    await new Promise<void>((resolvePromise, reject) => {
      client.once('open', () => {
        client.send('ping')
      })
      client.once('message', (data: WebSocket.RawData) => {
        try {
          expect(rawDataToString(data)).toBe('PING')
          resolvePromise()
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        } finally {
          client.close()
        }
      })
      client.once('error', reject)
    })
  })
})

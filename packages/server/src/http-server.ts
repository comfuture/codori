import net from 'node:net'
import websocket from '@fastify/websocket'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from 'fastify'
import WebSocket from 'ws'
import { CodoriError } from './errors.js'
import { createRuntimeManager } from './process-manager.js'
import type { ProjectStatusRecord, StartProjectResult } from './types.js'

type MaybePromise<T> = T | Promise<T>

export type RuntimeManagerLike = {
  listProjectStatuses: () => MaybePromise<ProjectStatusRecord[]>
  getProjectStatus: (projectId: string) => MaybePromise<ProjectStatusRecord>
  startProject: (projectId: string) => MaybePromise<StartProjectResult>
  stopProject: (projectId: string) => MaybePromise<ProjectStatusRecord>
  config?: {
    server: {
      host: string
      port: number
    }
  }
}

type ProjectResponse = {
  project: ProjectStatusRecord | StartProjectResult
}

type ProjectsResponse = {
  projects: ProjectStatusRecord[]
}

const isCodoriError = (error: unknown): error is CodoriError =>
  error instanceof CodoriError

const toStatusCode = (error: CodoriError) => {
  switch (error.code) {
    case 'PROJECT_NOT_FOUND':
      return 404
    case 'INVALID_CONFIG':
    case 'MISSING_PROJECT_ID':
    case 'MISSING_ROOT':
      return 400
    default:
      return 500
  }
}

const getProjectIdFromRequest = (value: string | undefined) => {
  if (!value) {
    throw new CodoriError('MISSING_PROJECT_ID', 'Missing project id.')
  }
  return value
}

const resolveValue = async <T>(value: MaybePromise<T>) => value

const wait = async (ms: number) =>
  new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })

const canConnectToPort = (port: number, host = '127.0.0.1', timeoutMs = 200) =>
  new Promise<boolean>((resolvePromise) => {
    const socket = net.createConnection({ host, port })
    let settled = false

    const settle = (value: boolean) => {
      if (settled) {
        return
      }

      settled = true
      socket.removeAllListeners()
      socket.destroy()
      resolvePromise(value)
    }

    socket.once('connect', () => settle(true))
    socket.once('error', () => settle(false))
    socket.setTimeout(timeoutMs, () => settle(false))
  })

const waitForPortReady = async (port: number, host = '127.0.0.1', timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await canConnectToPort(port, host)) {
      return true
    }

    await wait(100)
  }

  return false
}

export const createHttpServer = async (manager: RuntimeManagerLike): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false
  })

  await app.register(websocket)

  app.setErrorHandler((error: unknown, _request: FastifyRequest, reply: FastifyReply) => {
    if (isCodoriError(error)) {
      reply.status(toStatusCode(error)).send({
        error: {
          code: error.code,
          message: error.message,
          details: error.details ?? null
        }
      })
      return
    }

    reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error.'
      }
    })
  })

  app.get('/api/projects', async (): Promise<ProjectsResponse> => ({
    projects: await resolveValue(manager.listProjectStatuses())
  }))

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId',
    async (request: FastifyRequest<{ Params: { projectId: string } }>): Promise<ProjectResponse> => ({
      project: await resolveValue(manager.getProjectStatus(getProjectIdFromRequest(request.params.projectId)))
    })
  )

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/status',
    async (request: FastifyRequest<{ Params: { projectId: string } }>): Promise<ProjectResponse> => ({
      project: await resolveValue(manager.getProjectStatus(getProjectIdFromRequest(request.params.projectId)))
    })
  )

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/start',
    async (request: FastifyRequest<{ Params: { projectId: string } }>): Promise<ProjectResponse> => ({
      project: await resolveValue(manager.startProject(getProjectIdFromRequest(request.params.projectId)))
    })
  )

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/stop',
    async (request: FastifyRequest<{ Params: { projectId: string } }>): Promise<ProjectResponse> => ({
      project: await resolveValue(manager.stopProject(getProjectIdFromRequest(request.params.projectId)))
    })
  )

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/rpc',
    { websocket: true },
    async (clientSocket: WebSocket, request: FastifyRequest<{ Params: { projectId: string } }>) => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const pendingClientMessages: Array<{ message: WebSocket.RawData, isBinary: boolean }> = []
      let upstream: WebSocket | null = null

      const closeBoth = (code = 1011, reason = 'proxy error') => {
        if (clientSocket.readyState === clientSocket.OPEN || clientSocket.readyState === clientSocket.CONNECTING) {
          clientSocket.close(code, reason)
        }
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          upstream.close(code, reason)
        }
      }

      clientSocket.on('message', (message: WebSocket.RawData, isBinary: boolean) => {
        if (upstream?.readyState === WebSocket.OPEN) {
          upstream.send(message, { binary: isBinary })
          return
        }

        pendingClientMessages.push({ message, isBinary })
      })

      clientSocket.on('error', () => {
        closeBoth(1011, 'client websocket failed')
      })

      clientSocket.on('close', () => {
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          upstream.close()
        }
      })

      void (async () => {
        const started = await resolveValue(manager.startProject(projectId))
        if (typeof started.port !== 'number') {
          closeBoth(1011, 'runtime port unavailable')
          return
        }

        const ready = await waitForPortReady(started.port)
        if (!ready) {
          closeBoth(1011, 'runtime did not become ready')
          return
        }

        upstream = new WebSocket(`ws://127.0.0.1:${started.port}`)

        upstream.once('open', () => {
          for (const entry of pendingClientMessages.splice(0, pendingClientMessages.length)) {
            upstream?.send(entry.message, { binary: entry.isBinary })
          }
        })

        upstream.on('message', (message: WebSocket.RawData, isBinary: boolean) => {
          clientSocket.send(message, { binary: isBinary })
        })

        upstream.on('error', () => {
          closeBoth(1011, 'upstream websocket failed')
        })

        upstream.on('close', () => {
          if (clientSocket.readyState === clientSocket.OPEN || clientSocket.readyState === clientSocket.CONNECTING) {
            clientSocket.close()
          }
        })
      })().catch(() => {
        closeBoth(1011, 'upstream bootstrap failed')
      })
    }
  )

  return app
}

export const startHttpServer = async (manager = createRuntimeManager()) => {
  const app = await createHttpServer(manager)
  if (!manager.config) {
    throw new CodoriError('INVALID_CONFIG', 'Manager config is required to start the HTTP server.')
  }
  await app.listen({
    host: manager.config.server.host,
    port: manager.config.server.port
  })
  return app
}

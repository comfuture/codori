import { readFile, stat } from 'node:fs/promises'
import net from 'node:net'
import { existsSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import multipart from '@fastify/multipart'
import fastifyStatic from '@fastify/static'
import websocket from '@fastify/websocket'
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest
} from 'fastify'
import { lookup as lookupMimeType } from 'mime-types'
import WebSocket from 'ws'
import {
  isPathInsideDirectory,
  persistThreadAttachmentStream,
  type PersistedAttachment,
  readAttachmentMetadata,
  resolveProjectAttachmentsDir
} from './attachment-store.js'
import { CodoriError } from './errors.js'
import { createRuntimeManager } from './process-manager.js'
import {
  createServiceUpdateController,
  type ServiceUpdateController,
  type ServiceUpdateStatus
} from './service-update.js'
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

type ServiceUpdateResponse = {
  serviceUpdate: ServiceUpdateStatus
}

export type HttpServerOptions = {
  clientBundleDir?: string | null
  attachmentsRootDir?: string | null
  serviceUpdateController?: ServiceUpdateController | null
}

const isCodoriError = (error: unknown): error is CodoriError =>
  error instanceof CodoriError

const resolveBundledClientDir = () => {
  const candidates = [
    fileURLToPath(new URL('../client-dist', import.meta.url)),
    fileURLToPath(new URL('../../client/.output/public', import.meta.url))
  ]

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'index.html'))) {
      return candidate
    }
  }

  return null
}

const toRequestPath = (url: string) => url.split('?')[0]?.split('#')[0] ?? url

const isAssetRequest = (pathname: string) =>
  /\.[a-z0-9]+$/i.test(pathname)

const MAX_ATTACHMENTS_PER_MESSAGE = 8
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

const toStatusCode = (error: CodoriError) => {
  switch (error.code) {
    case 'PROJECT_NOT_FOUND':
      return 404
    case 'INVALID_CONFIG':
    case 'MISSING_PROJECT_ID':
    case 'MISSING_THREAD_ID':
    case 'INVALID_ATTACHMENT':
    case 'MISSING_ROOT':
      return 400
    case 'SERVICE_UPDATE_UNAVAILABLE':
    case 'SERVICE_UPDATE_IN_PROGRESS':
      return 409
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

const isStatusCodeCarrier = (error: unknown): error is { statusCode: number, message?: string, code?: string } =>
  typeof error === 'object'
  && error !== null
  && 'statusCode' in error
  && typeof (error as { statusCode?: unknown }).statusCode === 'number'

const normalizeImageMediaType = (input: { filename: string, declaredMediaType: string | null }) => {
  const declared = input.declaredMediaType?.trim().toLowerCase() ?? null
  if (declared?.startsWith('image/')) {
    return declared
  }

  if (declared) {
    return null
  }

  const inferred = lookupMimeType(input.filename)
  if (typeof inferred === 'string' && inferred.toLowerCase().startsWith('image/')) {
    return inferred.toLowerCase()
  }

  return null
}

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

export const createHttpServer = async (
  manager: RuntimeManagerLike,
  options: HttpServerOptions = {}
): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false
  })
  const clientBundleDir = options.clientBundleDir === undefined
    ? resolveBundledClientDir()
    : options.clientBundleDir
  const serviceUpdateController = options.serviceUpdateController ?? null

  await app.register(multipart, {
    limits: {
      files: MAX_ATTACHMENTS_PER_MESSAGE,
      fields: 4,
      fileSize: MAX_ATTACHMENT_BYTES
    }
  })
  await app.register(websocket)

  if (clientBundleDir) {
    await app.register(fastifyStatic, {
      root: clientBundleDir
    })
  }

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

    if (isStatusCodeCarrier(error)) {
      reply.status(error.statusCode).send({
        error: {
          code: error.code ?? 'REQUEST_ERROR',
          message: error.message ?? 'Request failed.'
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

  app.get('/api/service/update', async (): Promise<ServiceUpdateResponse> => ({
    serviceUpdate: serviceUpdateController
      ? await serviceUpdateController.getStatus()
      : {
          enabled: false,
          updateAvailable: false,
          updating: false,
          installedVersion: null,
          latestVersion: null
        }
  }))

  app.post('/api/service/update', async (_request, reply): Promise<ServiceUpdateResponse> => {
    if (!serviceUpdateController) {
      throw new CodoriError(
        'SERVICE_UPDATE_UNAVAILABLE',
        'Self-update is only available while Codori is running as a registered service.'
      )
    }

    reply.status(202)
    return {
      serviceUpdate: await serviceUpdateController.requestUpdate()
    }
  })

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

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/attachments',
    async (request, reply) => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const project = await resolveValue(manager.getProjectStatus(projectId))
      const files: PersistedAttachment[] = []
      let threadId: string | null = null

      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (!threadId) {
            throw new CodoriError('MISSING_THREAD_ID', 'Thread id must be provided before file parts.')
          }

          const mediaType = normalizeImageMediaType({
            filename: part.filename ?? 'attachment',
            declaredMediaType: part.mimetype || null
          })

          if (!mediaType) {
            throw new CodoriError('INVALID_ATTACHMENT', 'Only image attachments are supported.')
          }

          const attachment = await persistThreadAttachmentStream({
            projectPath: project.projectPath,
            threadId,
            filename: part.filename ?? 'attachment',
            mediaType,
            stream: part.file,
            rootDir: options.attachmentsRootDir
          })

          files.push(attachment)
          continue
        }

        if (part.fieldname === 'threadId' && typeof part.value === 'string') {
          threadId = part.value.trim() || null
        }
      }

      if (!threadId) {
        throw new CodoriError('MISSING_THREAD_ID', 'Missing thread id.')
      }

      if (!files.length) {
        throw new CodoriError('INVALID_ATTACHMENT', 'No files provided.')
      }

      reply.header('cache-control', 'no-store')
      return {
        threadId,
        files
      }
    }
  )

  app.get<{ Params: { projectId: string }, Querystring: { path?: string, mediaType?: string } }>(
    '/api/projects/:projectId/attachments/file',
    async (request, reply) => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const requestedPath = typeof request.query.path === 'string'
        ? request.query.path.trim()
        : ''

      if (!requestedPath) {
        throw new CodoriError('INVALID_ATTACHMENT', 'Missing attachment path.')
      }

      const project = await resolveValue(manager.getProjectStatus(projectId))
      const allowedRoot = resolveProjectAttachmentsDir(project.projectPath, options.attachmentsRootDir)
      const resolvedPath = resolve(requestedPath)

      if (!isPathInsideDirectory(resolvedPath, allowedRoot)) {
        reply.status(403)
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'Invalid attachment path.'
          }
        }
      }

      let fileStat
      try {
        fileStat = await stat(resolvedPath)
      } catch {
        reply.status(404)
        return {
          error: {
            code: 'NOT_FOUND',
            message: 'Attachment not found.'
          }
        }
      }

      if (!fileStat.isFile()) {
        reply.status(404)
        return {
          error: {
            code: 'NOT_FOUND',
            message: 'Attachment not found.'
          }
        }
      }

      const attachmentMetadata = await readAttachmentMetadata(resolvedPath)
      const inferredMediaType = typeof lookupMimeType(resolvedPath) === 'string'
        ? String(lookupMimeType(resolvedPath)).toLowerCase()
        : null
      const mediaType = attachmentMetadata?.mediaType?.toLowerCase()
        ?? inferredMediaType
        ?? null

      if (!mediaType?.startsWith('image/')) {
        reply.status(415)
        return {
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Attachment preview is only available for image files.'
          }
        }
      }

      reply.header('cache-control', 'private, max-age=3600')
      reply.header('cross-origin-resource-policy', 'cross-origin')
      reply.header('content-type', mediaType)
      reply.header('content-disposition', `inline; filename="${basename(resolvedPath).replace(/"/g, '')}"`)

      return await readFile(resolvedPath)
    }
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

  if (clientBundleDir) {
    app.setNotFoundHandler((request, reply) => {
      const requestPath = toRequestPath(request.url)
      const acceptsHtml = request.headers.accept?.includes('text/html') ?? false

      if (request.method !== 'GET') {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Route not found.'
          }
        })
      }

      if (requestPath.startsWith('/api/')) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Route not found.'
          }
        })
      }

      if (isAssetRequest(requestPath) && !acceptsHtml) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: 'Asset not found.'
          }
        })
      }

      return reply.type('text/html').sendFile('index.html')
    })
  }

  return app
}

export const startHttpServer = async (manager = createRuntimeManager()) => {
  if (!manager.config) {
    throw new CodoriError('INVALID_CONFIG', 'Manager config is required to start the HTTP server.')
  }
  const app = await createHttpServer(manager, {
    serviceUpdateController: createServiceUpdateController({
      root: manager.config.root
    })
  })
  await app.listen({
    host: manager.config.server.host,
    port: manager.config.server.port
  })
  return app
}

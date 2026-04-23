import { readFile, stat } from 'node:fs/promises'
import net from 'node:net'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, isAbsolute, join, resolve } from 'node:path'
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
import { createGitBranch, listGitBranches, switchGitBranch } from './git.js'
import { LocalFileViewError, readProjectLocalFile } from './local-file-viewer.js'
import { createRuntimeManager } from './process-manager.js'
import {
  createServiceUpdateController,
  type ServiceUpdateController,
  type ServiceUpdateStatus
} from './service-update.js'
import type {
  ChatSessionStatusRecord,
  DeleteChatSessionResult,
  ProjectStatusRecord,
  StartChatSessionResult,
  StartProjectResult,
  UpdateChatSessionThreadResult,
  UpdateChatSessionTitleResult
} from './types.js'

type MaybePromise<T> = T | Promise<T>

export type RuntimeManagerLike = {
  listProjectStatuses: () => MaybePromise<ProjectStatusRecord[]>
  listChatStatuses?: () => MaybePromise<ChatSessionStatusRecord[]>
  getProjectStatus: (projectId: string) => MaybePromise<ProjectStatusRecord>
  getChatStatus?: (chatId: string) => MaybePromise<ChatSessionStatusRecord>
  cloneProject?: (input: { repositoryUrl: string, destination?: string | null }) => MaybePromise<ProjectStatusRecord>
  createChatSession?: () => MaybePromise<StartChatSessionResult>
  deleteChatSession?: (chatId: string) => MaybePromise<DeleteChatSessionResult>
  updateChatSessionTitle?: (chatId: string, title: string) => MaybePromise<UpdateChatSessionTitleResult>
  updateChatSessionThread?: (chatId: string, threadId: string) => MaybePromise<UpdateChatSessionThreadResult>
  startProject: (projectId: string) => MaybePromise<StartProjectResult>
  startChatSession?: (chatId: string) => MaybePromise<StartChatSessionResult>
  stopProject: (projectId: string) => MaybePromise<ProjectStatusRecord>
  stopChatSession?: (chatId: string) => MaybePromise<ChatSessionStatusRecord>
  noteProjectActivity?: (projectId: string) => MaybePromise<ProjectStatusRecord | void>
  noteChatActivity?: (chatId: string) => MaybePromise<ChatSessionStatusRecord | void>
  acquireProjectSession?: (projectId: string) => {
    touchActivity?: (at?: number) => MaybePromise<ProjectStatusRecord | void>
    release: () => void
  }
  acquireChatSession?: (chatId: string) => {
    touchActivity?: (at?: number) => MaybePromise<ChatSessionStatusRecord | void>
    release: () => void
  }
  dispose?: () => MaybePromise<void>
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

type ChatResponse = {
  chat: ChatSessionStatusRecord | StartChatSessionResult
}

type ProjectsResponse = {
  projects: ProjectStatusRecord[]
}

type ChatsResponse = {
  chats: ChatSessionStatusRecord[]
}

type DeleteChatResponse = DeleteChatSessionResult

type ChatTitleRequest = {
  title?: string
}

type ChatThreadRequest = {
  threadId?: string
}

type ServiceUpdateResponse = {
  serviceUpdate: ServiceUpdateStatus
}

type ProjectGitBranchesResponse = {
  currentBranch: string | null
  branches: string[]
}

type ProjectGitBranchMutationRequest = {
  branch?: string
}

type ProjectLocalFileResponse = {
  file: {
    path: string
    relativePath: string
    name: string
    size: number
    updatedAt: number
    text: string
  }
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
    case 'CHAT_NOT_FOUND':
      return 404
    case 'INVALID_CONFIG':
    case 'INVALID_GIT_URL':
    case 'INVALID_GIT_BRANCH':
    case 'INVALID_PROJECT_DESTINATION':
    case 'MISSING_PROJECT_ID':
    case 'MISSING_CHAT_ID':
    case 'MISSING_THREAD_ID':
    case 'INVALID_ATTACHMENT':
    case 'MISSING_ROOT':
    case 'PROJECT_NOT_GIT_REPOSITORY':
    case 'INVALID_CHAT_TITLE':
      return 400
    case 'DESTINATION_EXISTS':
    case 'GIT_OPERATION_FAILED':
    case 'SERVICE_UPDATE_UNAVAILABLE':
    case 'SERVICE_UPDATE_IN_PROGRESS':
      return 409
    case 'PROJECT_CLONE_FAILED':
      return 502
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

const getChatIdFromRequest = (value: string | undefined) => {
  if (!value) {
    throw new CodoriError('MISSING_CHAT_ID', 'Missing chat id.')
  }
  return value
}

const ensureGitWorkspace = (project: ProjectStatusRecord) => {
  if (!project.projectPath) {
    throw new CodoriError(
      'PROJECT_NOT_GIT_REPOSITORY',
      'Git branch operations are not available for this workspace.'
    )
  }
}

const resolveMentionAssetRoots = (projectPath: string) => [
  resolve(projectPath, '.agents/plugins'),
  resolve(projectPath, '.codex/plugins'),
  resolve(homedir(), '.codex/plugins')
]

const WINDOWS_ABSOLUTE_PATH_PATTERN = /^[a-z]:[\\/]/i
const WINDOWS_UNC_PATH_PATTERN = /^\\\\[^\\]+\\[^\\]+/

const isAbsoluteFilesystemPath = (value: string) =>
  isAbsolute(value)
  || WINDOWS_ABSOLUTE_PATH_PATTERN.test(value)
  || WINDOWS_UNC_PATH_PATTERN.test(value)

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

const touchProjectActivity = async (manager: RuntimeManagerLike, projectId: string) => {
  if (!manager.noteProjectActivity) {
    return
  }

  await resolveValue(manager.noteProjectActivity(projectId))
}

const touchChatActivity = async (manager: RuntimeManagerLike, chatId: string) => {
  if (!manager.noteChatActivity) {
    return
  }

  await resolveValue(manager.noteChatActivity(chatId))
}

const touchProjectActivityInBackground = (
  manager: RuntimeManagerLike,
  projectId: string,
  session?: { touchActivity?: (at?: number) => MaybePromise<ProjectStatusRecord | void> } | null
) => {
  const task = session?.touchActivity
    ? resolveValue(session.touchActivity())
    : touchProjectActivity(manager, projectId)

  void task.catch(() => {})
}

const touchChatActivityInBackground = (
  manager: RuntimeManagerLike,
  chatId: string,
  session?: { touchActivity?: (at?: number) => MaybePromise<ChatSessionStatusRecord | void> } | null
) => {
  const task = session?.touchActivity
    ? resolveValue(session.touchActivity())
    : touchChatActivity(manager, chatId)

  void task.catch(() => {})
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

  app.addHook('onClose', async () => {
    await resolveValue(manager.dispose?.())
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

  app.get('/api/chats', async (): Promise<ChatsResponse> => ({
    chats: manager.listChatStatuses
      ? await resolveValue(manager.listChatStatuses())
      : []
  }))

  app.post('/api/chats', async (_request, reply): Promise<ChatResponse> => {
    if (!manager.createChatSession) {
      throw new CodoriError(
        'INVALID_CONFIG',
        'Chat creation is not available because the runtime manager does not support it.'
      )
    }

    reply.status(201)
    return {
      chat: await resolveValue(manager.createChatSession())
    }
  })

  app.get<{ Params: { chatId: string } }>(
    '/api/chats/:chatId',
    async (request: FastifyRequest<{ Params: { chatId: string } }>): Promise<ChatResponse> => {
      if (!manager.getChatStatus) {
        throw new CodoriError(
          'INVALID_CONFIG',
          'Chat lookup is not available because the runtime manager does not support it.'
        )
      }

      return {
        chat: await resolveValue(manager.getChatStatus(getChatIdFromRequest(request.params.chatId)))
      }
    }
  )

  app.delete<{ Params: { chatId: string } }>(
    '/api/chats/:chatId',
    async (request: FastifyRequest<{ Params: { chatId: string } }>): Promise<DeleteChatResponse> => {
      if (!manager.deleteChatSession) {
        throw new CodoriError(
          'INVALID_CONFIG',
          'Chat deletion is not available because the runtime manager does not support it.'
        )
      }

      return await resolveValue(manager.deleteChatSession(getChatIdFromRequest(request.params.chatId)))
    }
  )

  app.post<{ Params: { chatId: string }, Body: ChatTitleRequest }>(
    '/api/chats/:chatId/title',
    async (request: FastifyRequest<{ Params: { chatId: string }, Body: ChatTitleRequest }>): Promise<ChatResponse> => {
      if (!manager.updateChatSessionTitle) {
        throw new CodoriError(
          'INVALID_CONFIG',
          'Chat title updates are not available because the runtime manager does not support them.'
        )
      }

      return {
        chat: await resolveValue(manager.updateChatSessionTitle(
          getChatIdFromRequest(request.params.chatId),
          request.body?.title ?? ''
        ))
      }
    }
  )

  app.post<{ Params: { chatId: string }, Body: ChatThreadRequest }>(
    '/api/chats/:chatId/thread',
    async (request: FastifyRequest<{ Params: { chatId: string }, Body: ChatThreadRequest }>): Promise<ChatResponse> => {
      if (!manager.updateChatSessionThread) {
        throw new CodoriError(
          'INVALID_CONFIG',
          'Chat thread updates are not available because the runtime manager does not support them.'
        )
      }

      return {
        chat: await resolveValue(manager.updateChatSessionThread(
          getChatIdFromRequest(request.params.chatId),
          request.body?.threadId ?? ''
        ))
      }
    }
  )

  app.post<{ Body: { repositoryUrl?: string, destination?: string | null } }>(
    '/api/projects/clone',
    async (request, reply): Promise<ProjectResponse> => {
      if (!manager.cloneProject) {
        throw new CodoriError(
          'INVALID_CONFIG',
          'Project cloning is not available because the runtime manager does not support it.'
        )
      }

      const repositoryUrl = request.body?.repositoryUrl?.trim() ?? ''
      const destination = typeof request.body?.destination === 'string'
        ? request.body.destination
        : null

      reply.status(201)
      return {
        project: await resolveValue(manager.cloneProject({
          repositoryUrl,
          destination
        }))
      }
    }
  )

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

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/git/branches',
    async (request: FastifyRequest<{ Params: { projectId: string } }>): Promise<ProjectGitBranchesResponse> => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const project = await resolveValue(manager.getProjectStatus(projectId))
      await touchProjectActivity(manager, projectId)
      return await listGitBranches(project.projectPath)
    }
  )

  app.post<{ Params: { projectId: string }, Body: ProjectGitBranchMutationRequest }>(
    '/api/projects/:projectId/git/branches/switch',
    async (request: FastifyRequest<{ Params: { projectId: string }, Body: ProjectGitBranchMutationRequest }>): Promise<ProjectGitBranchesResponse> => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const project = await resolveValue(manager.getProjectStatus(projectId))
      ensureGitWorkspace(project)
      await touchProjectActivity(manager, projectId)
      return await switchGitBranch(project.projectPath, request.body?.branch ?? '')
    }
  )

  app.post<{ Params: { projectId: string }, Body: ProjectGitBranchMutationRequest }>(
    '/api/projects/:projectId/git/branches/create',
    async (request: FastifyRequest<{ Params: { projectId: string }, Body: ProjectGitBranchMutationRequest }>): Promise<ProjectGitBranchesResponse> => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const project = await resolveValue(manager.getProjectStatus(projectId))
      ensureGitWorkspace(project)
      await touchProjectActivity(manager, projectId)
      return await createGitBranch(project.projectPath, request.body?.branch ?? '')
    }
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

  app.post<{ Params: { chatId: string } }>(
    '/api/chats/:chatId/start',
    async (request: FastifyRequest<{ Params: { chatId: string } }>): Promise<ChatResponse> => {
      if (!manager.startChatSession) {
        throw new CodoriError(
          'INVALID_CONFIG',
          'Chat runtime start is not available because the runtime manager does not support it.'
        )
      }

      return {
        chat: await resolveValue(manager.startChatSession(getChatIdFromRequest(request.params.chatId)))
      }
    }
  )

  app.post<{ Params: { chatId: string } }>(
    '/api/chats/:chatId/stop',
    async (request: FastifyRequest<{ Params: { chatId: string } }>): Promise<ChatResponse> => {
      if (!manager.stopChatSession) {
        throw new CodoriError(
          'INVALID_CONFIG',
          'Chat runtime stop is not available because the runtime manager does not support it.'
        )
      }

      return {
        chat: await resolveValue(manager.stopChatSession(getChatIdFromRequest(request.params.chatId)))
      }
    }
  )

  app.post<{ Params: { chatId: string } }>(
    '/api/chats/:chatId/attachments',
    async (request, reply) => {
      if (!manager.getChatStatus) {
        throw new CodoriError('INVALID_CONFIG', 'Chat lookup is not available.')
      }

      const chatId = getChatIdFromRequest(request.params.chatId)
      const chat = await resolveValue(manager.getChatStatus(chatId))
      await touchChatActivity(manager, chatId)
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
            projectPath: chat.chatPath,
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

  app.get<{ Params: { chatId: string }, Querystring: { path?: string, mediaType?: string } }>(
    '/api/chats/:chatId/attachments/file',
    async (request, reply) => {
      if (!manager.getChatStatus) {
        throw new CodoriError('INVALID_CONFIG', 'Chat lookup is not available.')
      }

      const chatId = getChatIdFromRequest(request.params.chatId)
      const requestedPath = typeof request.query.path === 'string'
        ? request.query.path.trim()
        : ''

      if (!requestedPath) {
        throw new CodoriError('INVALID_ATTACHMENT', 'Missing attachment path.')
      }

      const chat = await resolveValue(manager.getChatStatus(chatId))
      await touchChatActivity(manager, chatId)
      const allowedRoot = resolveProjectAttachmentsDir(chat.chatPath, options.attachmentsRootDir)
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

  app.get<{ Params: { chatId: string }, Querystring: { path?: string } }>(
    '/api/chats/:chatId/mentions/icon',
    async (request, reply) => {
      if (!manager.getChatStatus) {
        throw new CodoriError('INVALID_CONFIG', 'Chat lookup is not available.')
      }

      const chatId = getChatIdFromRequest(request.params.chatId)
      const requestedPath = typeof request.query.path === 'string'
        ? request.query.path.trim()
        : ''

      if (!requestedPath) {
        throw new CodoriError('INVALID_ATTACHMENT', 'Missing mention asset path.')
      }

      if (!isAbsoluteFilesystemPath(requestedPath)) {
        reply.status(400)
        return {
          error: {
            code: 'INVALID_ATTACHMENT',
            message: 'Mention asset path must be absolute.'
          }
        }
      }

      const chat = await resolveValue(manager.getChatStatus(chatId))
      await touchChatActivity(manager, chatId)
      const resolvedPath = resolve(requestedPath)

      if (!resolveMentionAssetRoots(chat.chatPath).some(root => isPathInsideDirectory(resolvedPath, root))) {
        reply.status(403)
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'Invalid mention asset path.'
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
            message: 'Mention asset not found.'
          }
        }
      }

      if (!fileStat.isFile()) {
        reply.status(404)
        return {
          error: {
            code: 'NOT_FOUND',
            message: 'Mention asset not found.'
          }
        }
      }

      const mediaType = typeof lookupMimeType(resolvedPath) === 'string'
        ? String(lookupMimeType(resolvedPath)).toLowerCase()
        : null

      if (!mediaType?.startsWith('image/')) {
        reply.status(415)
        return {
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Mention assets must be image files.'
          }
        }
      }

      reply.header('cache-control', 'public, max-age=300')
      reply.header('cross-origin-resource-policy', 'cross-origin')
      reply.header('content-type', mediaType)
      reply.header('content-disposition', `inline; filename="${basename(resolvedPath).replace(/"/g, '')}"`)

      return await readFile(resolvedPath)
    }
  )

  app.get<{ Params: { chatId: string }, Querystring: { path?: string } }>(
    '/api/chats/:chatId/local-file',
    async (request, reply): Promise<ProjectLocalFileResponse | { error: { code: string, message: string } }> => {
      if (!manager.getChatStatus) {
        throw new CodoriError('INVALID_CONFIG', 'Chat lookup is not available.')
      }

      const chatId = getChatIdFromRequest(request.params.chatId)
      const requestedPath = typeof request.query.path === 'string'
        ? request.query.path.trim()
        : ''

      if (!requestedPath) {
        reply.status(400)
        return {
          error: {
            code: 'INVALID_LOCAL_FILE',
            message: 'Missing local file path.'
          }
        }
      }

      const chat = await resolveValue(manager.getChatStatus(chatId))
      await touchChatActivity(manager, chatId)

      try {
        const file = await readProjectLocalFile(chat.chatPath, requestedPath)
        reply.header('cache-control', 'no-store')
        return { file }
      } catch (error) {
        if (error instanceof LocalFileViewError) {
          const statusCode = error.code === 'FORBIDDEN'
            ? 403
            : error.code === 'NOT_FOUND' || error.code === 'NOT_A_FILE'
              ? 404
              : 415
          reply.status(statusCode)
          return {
            error: {
              code: error.code,
              message: error.message
            }
          }
        }

        throw error
      }
    }
  )

  app.get<{ Params: { chatId: string } }>(
    '/api/chats/:chatId/rpc',
    { websocket: true },
    async (clientSocket: WebSocket, request: FastifyRequest<{ Params: { chatId: string } }>) => {
      if (!manager.startChatSession) {
        clientSocket.close(1011, 'chat runtime unavailable')
        return
      }

      const chatId = getChatIdFromRequest(request.params.chatId)
      const pendingClientMessages: Array<{ message: WebSocket.RawData, isBinary: boolean }> = []
      const session = manager.acquireChatSession?.(chatId) ?? null
      let upstream: WebSocket | null = null
      let sessionReleased = false

      const releaseSession = () => {
        if (sessionReleased) {
          return
        }

        sessionReleased = true
        session?.release()
      }

      const closeBoth = (code = 1011, reason = 'proxy error') => {
        if (clientSocket.readyState === clientSocket.OPEN || clientSocket.readyState === clientSocket.CONNECTING) {
          clientSocket.close(code, reason)
        }
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          upstream.close(code, reason)
        }
      }

      clientSocket.on('message', (message: WebSocket.RawData, isBinary: boolean) => {
        touchChatActivityInBackground(manager, chatId, session)
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
        releaseSession()
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          upstream.close()
        }
      })

      void (async () => {
        const started = await resolveValue(manager.startChatSession!(chatId))
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
          touchChatActivityInBackground(manager, chatId, session)
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

  app.post<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/attachments',
    async (request, reply) => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const project = await resolveValue(manager.getProjectStatus(projectId))
      await touchProjectActivity(manager, projectId)
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
      await touchProjectActivity(manager, projectId)
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

  app.get<{ Params: { projectId: string }, Querystring: { path?: string } }>(
    '/api/projects/:projectId/mentions/icon',
    async (request, reply) => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const requestedPath = typeof request.query.path === 'string'
        ? request.query.path.trim()
        : ''

      if (!requestedPath) {
        throw new CodoriError('INVALID_ATTACHMENT', 'Missing mention asset path.')
      }

      if (!isAbsoluteFilesystemPath(requestedPath)) {
        reply.status(400)
        return {
          error: {
            code: 'INVALID_ATTACHMENT',
            message: 'Mention asset path must be absolute.'
          }
        }
      }

      const project = await resolveValue(manager.getProjectStatus(projectId))
      await touchProjectActivity(manager, projectId)
      const resolvedPath = resolve(requestedPath)

      if (!resolveMentionAssetRoots(project.projectPath).some(root => isPathInsideDirectory(resolvedPath, root))) {
        reply.status(403)
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'Invalid mention asset path.'
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
            message: 'Mention asset not found.'
          }
        }
      }

      if (!fileStat.isFile()) {
        reply.status(404)
        return {
          error: {
            code: 'NOT_FOUND',
            message: 'Mention asset not found.'
          }
        }
      }

      const mediaType = typeof lookupMimeType(resolvedPath) === 'string'
        ? String(lookupMimeType(resolvedPath)).toLowerCase()
        : null

      if (!mediaType?.startsWith('image/')) {
        reply.status(415)
        return {
          error: {
            code: 'UNSUPPORTED_MEDIA_TYPE',
            message: 'Mention assets must be image files.'
          }
        }
      }

      reply.header('cache-control', 'public, max-age=300')
      reply.header('cross-origin-resource-policy', 'cross-origin')
      reply.header('content-type', mediaType)
      reply.header('content-disposition', `inline; filename="${basename(resolvedPath).replace(/"/g, '')}"`)

      return await readFile(resolvedPath)
    }
  )

  app.get<{ Params: { projectId: string }, Querystring: { path?: string } }>(
    '/api/projects/:projectId/local-file',
    async (request, reply): Promise<ProjectLocalFileResponse | { error: { code: string, message: string } }> => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const requestedPath = typeof request.query.path === 'string'
        ? request.query.path.trim()
        : ''

      if (!requestedPath) {
        reply.status(400)
        return {
          error: {
            code: 'INVALID_LOCAL_FILE',
            message: 'Missing local file path.'
          }
        }
      }

      const project = await resolveValue(manager.getProjectStatus(projectId))
      await touchProjectActivity(manager, projectId)

      try {
        const file = await readProjectLocalFile(project.projectPath, requestedPath)
        reply.header('cache-control', 'no-store')
        return { file }
      } catch (error) {
        if (error instanceof LocalFileViewError) {
          const statusCode = error.code === 'FORBIDDEN'
            ? 403
            : error.code === 'NOT_FOUND' || error.code === 'NOT_A_FILE'
              ? 404
              : 415
          reply.status(statusCode)
          return {
            error: {
              code: error.code,
              message: error.message
            }
          }
        }

        throw error
      }
    }
  )

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/rpc',
    { websocket: true },
    async (clientSocket: WebSocket, request: FastifyRequest<{ Params: { projectId: string } }>) => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const pendingClientMessages: Array<{ message: WebSocket.RawData, isBinary: boolean }> = []
      const session = manager.acquireProjectSession?.(projectId) ?? null
      let upstream: WebSocket | null = null
      let sessionReleased = false

      const releaseSession = () => {
        if (sessionReleased) {
          return
        }

        sessionReleased = true
        session?.release()
      }

      const closeBoth = (code = 1011, reason = 'proxy error') => {
        if (clientSocket.readyState === clientSocket.OPEN || clientSocket.readyState === clientSocket.CONNECTING) {
          clientSocket.close(code, reason)
        }
        if (upstream && (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING)) {
          upstream.close(code, reason)
        }
      }

      clientSocket.on('message', (message: WebSocket.RawData, isBinary: boolean) => {
        touchProjectActivityInBackground(manager, projectId, session)
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
        releaseSession()
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
          touchProjectActivityInBackground(manager, projectId, session)
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

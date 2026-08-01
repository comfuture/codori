import { readFile, stat } from 'node:fs/promises'
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
import { bridgeCodexRpcWebSocket } from './codori-rpc-bridge.js'
import { createGitBranch, listGitBranches, switchGitBranch } from './git.js'
import { LocalFileViewError, readProjectLocalFile, type LocalFileReadResult } from './local-file-viewer.js'
import { createRuntimeManager } from './process-manager.js'
import {
  listWorkspaceDirectory,
  WorkspaceDirectoryError,
  type WorkspaceDirectoryListing
} from './workspace-file-explorer.js'
import {
  createServiceUpdateController,
  type ServiceUpdateController,
  type ServiceUpdateStatus
} from './service-update.js'
import { ServerAvatarResolver } from './server-avatar.js'
import type {
  AppServerTarget,
  ChatSessionStatusRecord,
  DeleteChatSessionResult,
  ProjectRootResponse,
  ProjectStatusRecord,
  RuntimeBackendStatusResponse,
  RuntimeBridgeTarget,
  ServerCapabilitiesResponse,
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
  setProjectRoot?: (root: string) => string
  getLastProjectRoot?: () => string | null
  cloneProject?: (input: { repositoryUrl: string, destination?: string | null }) => MaybePromise<ProjectStatusRecord>
  createChatSession?: () => MaybePromise<StartChatSessionResult>
  deleteChatSession?: (chatId: string) => MaybePromise<DeleteChatSessionResult>
  updateChatSessionTitle?: (chatId: string, title: string) => MaybePromise<UpdateChatSessionTitleResult>
  updateChatSessionThread?: (chatId: string, threadId: string | null) => MaybePromise<UpdateChatSessionThreadResult>
  startProject: (projectId: string) => MaybePromise<StartProjectResult>
  startChatSession?: (chatId: string) => MaybePromise<StartChatSessionResult>
  getProjectBridgeTarget?: (projectId: string) => MaybePromise<RuntimeBridgeTarget>
  getChatBridgeTarget?: (chatId: string) => MaybePromise<RuntimeBridgeTarget>
  getRuntimeBackendStatus?: () => RuntimeBackendStatusResponse['backend']
  invalidateRuntimeTarget?: (target: AppServerTarget) => void
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
  resetStoredRuntimes?: () => MaybePromise<number>
  dispose?: () => MaybePromise<void>
  config?: {
    root: string
    server: {
      host: string
      port: number
    }
    realtimeVoice?: {
      enabled: boolean
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
  threadId?: string | null
}

type ServiceUpdateResponse = {
  serviceUpdate: ServiceUpdateStatus
}

type ProjectRootRequest = {
  root?: string
}

type ProjectGitBranchesResponse = {
  currentBranch: string | null
  branches: string[]
}

type ProjectGitBranchMutationRequest = {
  branch?: string
}

type ProjectLocalFileResponse = {
  file: LocalFileReadResult
}

type WorkspaceDirectoryResponse = {
  directory: WorkspaceDirectoryListing
}

export type HttpServerOptions = {
  clientBundleDir?: string | null
  attachmentsRootDir?: string | null
  serviceUpdateController?: ServiceUpdateController | null
  avatarResolver?: ServerAvatarResolver
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
    case 'INVALID_ROOT':
    case 'PROJECT_NOT_GIT_REPOSITORY':
    case 'INVALID_CHAT_TITLE':
      return 400
    case 'DESTINATION_EXISTS':
    case 'GIT_OPERATION_FAILED':
    case 'SERVICE_UPDATE_UNAVAILABLE':
    case 'SERVICE_UPDATE_IN_PROGRESS':
      return 409
    case 'PROJECT_ROOT_UPDATE_UNAVAILABLE':
      return 501
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

export const createHttpServer = async (
  manager: RuntimeManagerLike,
  options: HttpServerOptions = {}
): Promise<FastifyInstance> => {
  const app = Fastify({
    logger: false
  })
  const avatarResolver = options.avatarResolver ?? new ServerAvatarResolver()

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

  app.get('/api/capabilities', async (): Promise<ServerCapabilitiesResponse> => ({
    capabilities: {
      realtimeVoice: {
        configured: manager.config?.realtimeVoice?.enabled ?? false,
        experimental: true,
        feature: 'realtime_conversation'
      }
    }
  }))

  app.get('/api/runtime/backend', async (): Promise<RuntimeBackendStatusResponse> => ({
    backend: manager.getRuntimeBackendStatus?.() ?? {
      backend: null,
      transport: null,
      state: 'idle',
      version: null,
      fallbackReason: null
    }
  }))

  app.get('/api/config/root', async (): Promise<ProjectRootResponse> => ({
    projectRoot: {
      root: manager.config?.root ?? '',
      lastRoot: manager.getLastProjectRoot?.() ?? null
    }
  }))

  app.patch<{ Body: ProjectRootRequest }>(
    '/api/config/root',
    async (request: FastifyRequest<{ Body: ProjectRootRequest }>): Promise<ProjectRootResponse> => {
      const requestedRoot = typeof request.body?.root === 'string' ? request.body.root.trim() : ''
      if (!requestedRoot) {
        throw new CodoriError('MISSING_ROOT', 'A project root is required.')
      }

      if (!manager.setProjectRoot) {
        throw new CodoriError(
          'PROJECT_ROOT_UPDATE_UNAVAILABLE',
          'This runtime does not support changing the project root.'
        )
      }

      const root = manager.setProjectRoot(requestedRoot)
      return {
        projectRoot: {
          root,
          lastRoot: manager.getLastProjectRoot?.() ?? null
        }
      }
    }
  )

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
          request.body?.threadId ?? null
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

  app.get<{ Params: { chatId: string }, Querystring: { path?: string, showIgnored?: string } }>(
    '/api/chats/:chatId/files',
    async (request, reply): Promise<WorkspaceDirectoryResponse | { error: { code: string, message: string } }> => {
      if (!manager.getChatStatus) {
        throw new CodoriError('INVALID_CONFIG', 'Chat lookup is not available.')
      }

      const chatId = getChatIdFromRequest(request.params.chatId)
      const requestedPath = typeof request.query.path === 'string'
        ? request.query.path
        : ''
      const chat = await resolveValue(manager.getChatStatus(chatId))
      await touchChatActivity(manager, chatId)

      try {
        const directory = await listWorkspaceDirectory(chat.chatPath, requestedPath, {
          showIgnored: request.query.showIgnored === 'true'
        })
        reply.header('cache-control', 'no-store')
        return { directory }
      } catch (error) {
        if (error instanceof WorkspaceDirectoryError) {
          reply.status(error.code === 'NOT_FOUND' || error.code === 'NOT_A_DIRECTORY' ? 404 : 403)
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
      const session = manager.acquireChatSession?.(chatId) ?? null
      bridgeCodexRpcWebSocket({
        clientSocket,
        avatarResolver,
        startRuntime: async () => {
          if (manager.getChatBridgeTarget) {
            return await resolveValue(manager.getChatBridgeTarget(chatId))
          }
          const started = await resolveValue(manager.startChatSession!(chatId))
          if (started.pid === null || started.port === null) {
            throw new Error('Chat runtime did not report a managed app-server target.')
          }
          return {
            target: {
              kind: 'codori-managed',
              transport: 'tcp-websocket',
              port: started.port,
              pid: started.pid,
              ownedByCodori: true,
              appServerVersion: null
            },
            workspacePath: started.chatPath
          }
        },
        touchActivity: () => {
          touchChatActivityInBackground(manager, chatId, session)
        },
        releaseSession: () => {
          session?.release()
        },
        invalidateTarget: target => manager.invalidateRuntimeTarget?.(target)
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

  app.get<{ Params: { projectId: string }, Querystring: { path?: string, showIgnored?: string } }>(
    '/api/projects/:projectId/files',
    async (request, reply): Promise<WorkspaceDirectoryResponse | { error: { code: string, message: string } }> => {
      const projectId = getProjectIdFromRequest(request.params.projectId)
      const requestedPath = typeof request.query.path === 'string'
        ? request.query.path
        : ''
      const project = await resolveValue(manager.getProjectStatus(projectId))
      await touchProjectActivity(manager, projectId)

      try {
        const directory = await listWorkspaceDirectory(project.projectPath, requestedPath, {
          showIgnored: request.query.showIgnored === 'true'
        })
        reply.header('cache-control', 'no-store')
        return { directory }
      } catch (error) {
        if (error instanceof WorkspaceDirectoryError) {
          reply.status(error.code === 'NOT_FOUND' || error.code === 'NOT_A_DIRECTORY' ? 404 : 403)
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
      const session = manager.acquireProjectSession?.(projectId) ?? null
      bridgeCodexRpcWebSocket({
        clientSocket,
        avatarResolver,
        startRuntime: async () => {
          if (manager.getProjectBridgeTarget) {
            return await resolveValue(manager.getProjectBridgeTarget(projectId))
          }
          const started = await resolveValue(manager.startProject(projectId))
          if (started.pid === null || started.port === null) {
            throw new Error('Project runtime did not report a managed app-server target.')
          }
          return {
            target: {
              kind: 'codori-managed',
              transport: 'tcp-websocket',
              port: started.port,
              pid: started.pid,
              ownedByCodori: true,
              appServerVersion: null
            },
            workspacePath: started.projectPath
          }
        },
        touchActivity: () => {
          touchProjectActivityInBackground(manager, projectId, session)
        },
        releaseSession: () => {
          session?.release()
        },
        invalidateTarget: target => manager.invalidateRuntimeTarget?.(target)
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

      if (requestPath === '/xr' || requestPath.startsWith('/xr/')) {
        return reply.type('text/html').sendFile('xr/index.html')
      }

      return reply.type('text/html').sendFile('index.html')
    })
  }

  return app
}

export const startHttpServer = async (manager: RuntimeManagerLike = createRuntimeManager()) => {
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
  try {
    await resolveValue(manager.resetStoredRuntimes?.() ?? 0)
  } catch (error) {
    await app.close()
    throw error
  }
  return app
}

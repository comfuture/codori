import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import {
  createServer as createNodeHttpServer,
  type Server as NodeHttpServer
} from 'node:http'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { resolveProjectAttachmentsDir } from '../src/attachment-store.js'
import { CodoriError } from '../src/errors.js'
import { createHttpServer, startHttpServer, type RuntimeManagerLike } from '../src/http-server.js'
import { MAX_LOCAL_FILE_VIEW_BYTES } from '../src/local-file-viewer.js'
import type { ServerAvatarResolver } from '../src/server-avatar.js'
import type { ServiceUpdateController } from '../src/service-update.js'
import type {
  ChatSessionStatusRecord,
  ProjectStatusRecord,
  StartChatSessionResult,
  StartProjectResult
} from '../src/types.js'

const startedApps: Array<Awaited<ReturnType<typeof createHttpServer>>> = []
const startedSocketServers: WebSocketServer[] = []
const startedNodeHttpServers: NodeHttpServer[] = []
const occupiedTcpServers: Array<ReturnType<typeof createNetServer>> = []
const attachmentsRoots: string[] = []
const tempDirs: string[] = []

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

  for (const server of startedNodeHttpServers.splice(0, startedNodeHttpServers.length)) {
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

  for (const root of attachmentsRoots.splice(0, attachmentsRoots.length)) {
    await rm(root, { recursive: true, force: true })
  }

  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    await rm(dir, { recursive: true, force: true })
  }
})

const createProjectRecord = (): ProjectStatusRecord => ({
  projectId: 'demo',
  projectPath: '/tmp/demo',
  status: 'running',
  pid: 123,
  port: 46000,
  startedAt: 1,
  lastActivityAt: 1,
  activeSessionCount: 0,
  idleTimeoutMs: 30 * 60 * 1000,
  idleDeadlineAt: 30 * 60 * 1000 + 1,
  error: null
})

const createChatRecord = (): ChatSessionStatusRecord => ({
  chatId: 'chat-test',
  chatPath: '/tmp/chats/chat-test',
  threadId: null,
  title: 'New Chat',
  createdAt: 1,
  updatedAt: 1,
  status: 'running',
  pid: 123,
  port: 46000,
  startedAt: 1,
  lastActivityAt: 1,
  activeSessionCount: 0,
  idleTimeoutMs: 30 * 60 * 1000,
  idleDeadlineAt: 30 * 60 * 1000 + 1,
  error: null
})

const createManager = (overrides: Partial<RuntimeManagerLike> = {}): RuntimeManagerLike => ({
  listProjectStatuses: () => [createProjectRecord()],
  listChatStatuses: () => [],
  getProjectStatus: () => createProjectRecord(),
  getChatStatus: () => createChatRecord(),
  cloneProject: () => createProjectRecord(),
  createChatSession: () => ({
    ...createChatRecord(),
    reusedExisting: false
  }),
  deleteChatSession: chatId => ({
    chatId
  }),
  updateChatSessionTitle: (chatId, title) => ({
    ...createChatRecord(),
    chatId,
    chatPath: `/tmp/${chatId}`,
    title
  }),
  updateChatSessionThread: (chatId, threadId) => ({
    ...createChatRecord(),
    chatId,
    threadId
  }),
  startProject: () => ({
    ...createProjectRecord(),
    reusedExisting: true
  }),
  startChatSession: () => ({
    ...createChatRecord(),
    reusedExisting: true
  }),
  stopProject: () => ({
    ...createProjectRecord(),
    status: 'stopped',
    pid: null,
    port: null,
    startedAt: null,
    lastActivityAt: null,
    idleDeadlineAt: null
  }),
  noteProjectActivity: () => {},
  acquireProjectSession: () => ({
    touchActivity: () => {},
    release: () => {}
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

const createGitRepo = () => {
  const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-git-'))
  tempDirs.push(projectPath)
  execFileSync('git', ['init', '-b', 'main'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.name', 'Codori Test'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['config', 'user.email', 'codori@example.com'], { cwd: projectPath, stdio: 'ignore' })
  writeFileSync(join(projectPath, 'README.md'), '# test\n')
  execFileSync('git', ['add', 'README.md'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['commit', '-m', 'init'], { cwd: projectPath, stdio: 'ignore' })
  execFileSync('git', ['branch', 'feature/review'], { cwd: projectPath, stdio: 'ignore' })
  return projectPath
}

describe('createHttpServer', () => {
  it('does not reset stored runtimes when startup binding fails', async () => {
    const blocker = createNetServer()
    await new Promise<void>((resolvePromise, reject) => {
      blocker.listen(0, '127.0.0.1', (error?: Error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      })
    })
    occupiedTcpServers.push(blocker)

    const address = blocker.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get blocker server address.')
    }

    let resetCalls = 0
    const manager = createManager({
      resetStoredRuntimes: () => {
        resetCalls += 1
        return 0
      },
      config: {
        root: '/tmp',
        server: {
          host: '127.0.0.1',
          port: address.port
        }
      }
    })

    await expect(startHttpServer(manager)).rejects.toMatchObject({
      code: 'EADDRINUSE'
    })
    expect(resetCalls).toBe(0)
  })

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

  it('reports the configured experimental realtime voice capability', async () => {
    const app = await createHttpServer(createManager({
      config: {
        root: '/tmp',
        server: {
          host: '127.0.0.1',
          port: 4310
        },
        realtimeVoice: {
          enabled: true
        }
      }
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/capabilities'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      capabilities: {
        realtimeVoice: {
          configured: true,
          experimental: true,
          feature: 'realtime_conversation'
        }
      }
    })
  })

  it('reports safe typed runtime backend status without a socket path', async () => {
    const app = await createHttpServer(createManager({
      getRuntimeBackendStatus: () => ({
        backend: 'codori-managed',
        transport: 'tcp-websocket',
        state: 'fallback',
        version: '0.145.0',
        fallbackReason: 'incompatible-realtime'
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/runtime/backend'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      backend: {
        backend: 'codori-managed',
        transport: 'tcp-websocket',
        state: 'fallback',
        version: '0.145.0',
        fallbackReason: 'incompatible-realtime'
      }
    })
    expect(response.body).not.toContain('socketPath')
  })

  it('clones a project through the management API', async () => {
    const app = await createHttpServer(createManager({
      cloneProject: ({ repositoryUrl, destination }) => ({
        ...createProjectRecord(),
        projectId: destination ?? 'demo',
        projectPath: `/tmp/${destination ?? 'demo'}`,
        error: repositoryUrl ? null : 'missing'
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: {
        repositoryUrl: 'https://github.com/comfuture/codori',
        destination: 'team/codori'
      }
    })

    expect(response.statusCode).toBe(201)
    expect(response.json()).toEqual({
      project: {
        ...createProjectRecord(),
        projectId: 'team/codori',
        projectPath: '/tmp/team/codori'
      }
    })
  })

  it('creates and lists recent chats through the management API', async () => {
    const chatRecord: ChatSessionStatusRecord = {
      ...createChatRecord(),
      chatId: 'chat-recent',
      chatPath: '/tmp/chats/chat-recent',
      title: 'Recent chat',
      createdAt: 10
    }
    const app = await createHttpServer(createManager({
      listChatStatuses: () => [chatRecord],
      createChatSession: () => ({
        ...chatRecord,
        chatId: 'chat-new',
        chatPath: '/tmp/chats/chat-new',
        title: 'New Chat',
        createdAt: 11,
        reusedExisting: false
      })
    }))
    startedApps.push(app)

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/chats'
    })
    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toEqual({
      chats: [chatRecord]
    })

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/chats'
    })
    expect(createResponse.statusCode).toBe(201)
    expect(createResponse.json()).toEqual({
      chat: {
        ...chatRecord,
        chatId: 'chat-new',
        chatPath: '/tmp/chats/chat-new',
        title: 'New Chat',
        createdAt: 11,
        reusedExisting: false
      }
    })
  })

  it('deletes a chat through the management API', async () => {
    const app = await createHttpServer(createManager({
      deleteChatSession: chatId => ({ chatId })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/chats/chat-recent'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      chatId: 'chat-recent'
    })
  })

  it('updates a chat title through the management API', async () => {
    const app = await createHttpServer(createManager({
      updateChatSessionTitle: (chatId, title) => ({
        ...createChatRecord(),
        chatId,
        chatPath: '/tmp/chats/chat-recent',
        title
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/chats/chat-recent/title',
      payload: {
        title: 'Investigate chat titles'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      chat: {
        ...createChatRecord(),
        chatId: 'chat-recent',
        chatPath: '/tmp/chats/chat-recent',
        title: 'Investigate chat titles'
      }
    })
  })

  it('clears a chat thread through the management API', async () => {
    const app = await createHttpServer(createManager({
      updateChatSessionThread: (chatId, threadId) => ({
        ...createChatRecord(),
        chatId,
        chatPath: '/tmp/chats/chat-recent',
        threadId
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/chats/chat-recent/thread',
      payload: {
        threadId: null
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      chat: {
        ...createChatRecord(),
        chatId: 'chat-recent',
        chatPath: '/tmp/chats/chat-recent',
        threadId: null
      }
    })
  })

  it('maps clone validation errors to structured API responses', async () => {
    const app = await createHttpServer(createManager({
      cloneProject: () => {
        throw new CodoriError(
          'DESTINATION_EXISTS',
          'Destination "team/codori" already exists under the configured Codori root.'
        )
      }
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/clone',
      payload: {
        repositoryUrl: 'https://github.com/comfuture/codori',
        destination: 'team/codori'
      }
    })

    expect(response.statusCode).toBe(409)
    expect(response.json()).toEqual({
      error: {
        code: 'DESTINATION_EXISTS',
        message: 'Destination "team/codori" already exists under the configured Codori root.',
        details: null
      }
    })
  })

  it('returns service update status and accepts update requests for managed services', async () => {
    const serviceUpdateController: ServiceUpdateController = {
      getStatus: async () => ({
        enabled: true,
        updateAvailable: true,
        updating: false,
        installedVersion: '0.0.3',
        latestVersion: '0.0.4'
      }),
      requestUpdate: async () => ({
        enabled: true,
        updateAvailable: true,
        updating: true,
        installedVersion: '0.0.3',
        latestVersion: '0.0.4'
      })
    }
    const app = await createHttpServer(createManager(), {
      serviceUpdateController
    })
    startedApps.push(app)

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/service/update'
    })
    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toEqual({
      serviceUpdate: {
        enabled: true,
        updateAvailable: true,
        updating: false,
        installedVersion: '0.0.3',
        latestVersion: '0.0.4'
      }
    })

    const updateResponse = await app.inject({
      method: 'POST',
      url: '/api/service/update'
    })
    expect(updateResponse.statusCode).toBe(202)
    expect(updateResponse.json()).toEqual({
      serviceUpdate: {
        enabled: true,
        updateAvailable: true,
        updating: true,
        installedVersion: '0.0.3',
        latestVersion: '0.0.4'
      }
    })
  })

  it('reads and changes the served project root', async () => {
    const nextRoot = mkdtempSync(join(os.tmpdir(), 'codori-next-root-'))
    tempDirs.push(nextRoot)

    let currentRoot = '/tmp/original-root'
    let lastRoot: string | null = null
    const app = await createHttpServer(createManager({
      config: {
        root: currentRoot
      } as RuntimeManagerLike['config'],
      setProjectRoot: (root: string) => {
        currentRoot = root
        lastRoot = root
        return root
      },
      getLastProjectRoot: () => lastRoot
    }))
    startedApps.push(app)

    const readResponse = await app.inject({
      method: 'GET',
      url: '/api/config/root'
    })
    expect(readResponse.statusCode).toBe(200)
    expect(readResponse.json()).toEqual({
      projectRoot: {
        root: '/tmp/original-root',
        lastRoot: null
      }
    })

    const patchResponse = await app.inject({
      method: 'PATCH',
      url: '/api/config/root',
      payload: {
        root: nextRoot
      }
    })
    expect(patchResponse.statusCode).toBe(200)
    expect(patchResponse.json()).toEqual({
      projectRoot: {
        root: nextRoot,
        lastRoot: nextRoot
      }
    })
  })

  it('rejects a blank project root change', async () => {
    const app = await createHttpServer(createManager({
      setProjectRoot: (root: string) => root
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'PATCH',
      url: '/api/config/root',
      payload: {
        root: '   '
      }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json().error.code).toBe('MISSING_ROOT')
  })

  it('lists local git branches for a project', async () => {
    const projectPath = createGitRepo()
    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/demo/git/branches'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      currentBranch: 'main',
      branches: ['feature/review', 'main']
    })
  })

  it('switches to another local git branch for a project', async () => {
    const projectPath = createGitRepo()
    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/git/branches/switch',
      payload: {
        branch: 'feature/review'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      currentBranch: 'feature/review',
      branches: ['feature/review', 'main']
    })
  })

  it('creates and switches to a new local git branch for a project', async () => {
    const projectPath = createGitRepo()
    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/git/branches/create',
      payload: {
        branch: 'feature/new-work'
      }
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      currentBranch: 'feature/new-work',
      branches: ['feature/new-work', 'feature/review', 'main']
    })
  })

  it('rejects invalid local git branch names', async () => {
    const projectPath = createGitRepo()
    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/git/branches/create',
      payload: {
        branch: 'feature with spaces'
      }
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: {
        code: 'INVALID_GIT_BRANCH',
        message: 'Branch name "feature with spaces" is not a valid local branch name.',
        details: null
      }
    })
  })

  it('returns an empty branch list when the project is not a git repository', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-non-git-'))
    tempDirs.push(projectPath)

    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/demo/git/branches'
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      currentBranch: null,
      branches: []
    })
  })

  it('serves the bundled client and falls back to index.html for app routes', async () => {
    const bundleDir = mkdtempSync(join(os.tmpdir(), 'codori-ui-'))
    writeFileSync(join(bundleDir, 'index.html'), '<html><body>codori ui</body></html>')
    writeFileSync(join(bundleDir, 'asset.txt'), 'static asset')
    mkdirSync(join(bundleDir, 'xr', 'assets'), { recursive: true })
    writeFileSync(join(bundleDir, 'xr', 'index.html'), '<html><body>immersive codori</body></html>')
    writeFileSync(join(bundleDir, 'xr', 'assets', 'scene.js'), 'immersive asset')

    const app = await createHttpServer(createManager(), {
      clientBundleDir: bundleDir
    })
    startedApps.push(app)

    const indexResponse = await app.inject({
      method: 'GET',
      url: '/'
    })
    expect(indexResponse.statusCode).toBe(200)
    expect(indexResponse.body).toContain('codori ui')

    const appRouteResponse = await app.inject({
      method: 'GET',
      url: '/projects/demo/threads/thread-1'
    })
    expect(appRouteResponse.statusCode).toBe(200)
    expect(appRouteResponse.body).toContain('codori ui')

    const dottedRouteResponse = await app.inject({
      method: 'GET',
      url: '/projects/demo.app',
      headers: {
        accept: 'text/html'
      }
    })
    expect(dottedRouteResponse.statusCode).toBe(200)
    expect(dottedRouteResponse.body).toContain('codori ui')

    const assetResponse = await app.inject({
      method: 'GET',
      url: '/asset.txt'
    })
    expect(assetResponse.statusCode).toBe(200)
    expect(assetResponse.body).toBe('static asset')

    const xrIndexResponse = await app.inject({
      method: 'GET',
      url: '/xr/'
    })
    expect(xrIndexResponse.statusCode).toBe(200)
    expect(xrIndexResponse.body).toContain('immersive codori')

    const xrNoTrailingSlashResponse = await app.inject({
      method: 'GET',
      url: '/xr'
    })
    expect(xrNoTrailingSlashResponse.statusCode).toBe(200)
    expect(xrNoTrailingSlashResponse.body).toContain('immersive codori')

    const xrNestedRouteResponse = await app.inject({
      method: 'GET',
      url: '/xr/projects/demo/threads/thread-1'
    })
    expect(xrNestedRouteResponse.statusCode).toBe(200)
    expect(xrNestedRouteResponse.body).toContain('immersive codori')

    const xrAssetResponse = await app.inject({
      method: 'GET',
      url: '/xr/assets/scene.js'
    })
    expect(xrAssetResponse.statusCode).toBe(200)
    expect(xrAssetResponse.body).toBe('immersive asset')
    expect(xrAssetResponse.headers['cache-control']).toBe(assetResponse.headers['cache-control'])

    const missingAssetResponse = await app.inject({
      method: 'GET',
      url: '/missing.css?v=1',
      headers: {
        accept: 'text/css,*/*;q=0.1'
      }
    })
    expect(missingAssetResponse.statusCode).toBe(404)
    expect(missingAssetResponse.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Asset not found.'
      }
    })

    const missingXrAssetResponse = await app.inject({
      method: 'GET',
      url: '/xr/assets/missing.js?v=1',
      headers: {
        accept: '*/*'
      }
    })
    expect(missingXrAssetResponse.statusCode).toBe(404)
    expect(missingXrAssetResponse.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Asset not found.'
      }
    })

    const apiResponse = await app.inject({
      method: 'GET',
      url: '/api/projects'
    })
    expect(apiResponse.statusCode).toBe(200)
    expect(apiResponse.json()).toEqual({
      projects: [createProjectRecord()]
    })

    const missingApiResponse = await app.inject({
      method: 'GET',
      url: '/api/not-found',
      headers: {
        accept: 'text/html'
      }
    })
    expect(missingApiResponse.statusCode).toBe(404)
    expect(missingApiResponse.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found.'
      }
    })
  })

  it('bridges websocket frames to the shared app-server', async () => {
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

  it('bridges WebSocket frames over Unix and invalidates a disconnected daemon target', async () => {
    const socketRoot = mkdtempSync(join(os.tmpdir(), 'codori-unix-websocket-'))
    tempDirs.push(socketRoot)
    const socketPath = join(socketRoot, 'daemon.sock')
    const receivedFrames: string[] = []
    let closeUpstream = () => {}
    const unixHttpServer = createNodeHttpServer()
    startedNodeHttpServers.push(unixHttpServer)
    const unixWebSocketServer = new WebSocketServer({
      server: unixHttpServer
    })
    startedSocketServers.push(unixWebSocketServer)
    unixWebSocketServer.on('connection', (socket) => {
      closeUpstream = () => socket.close()
      socket.on('message', (message, isBinary) => {
        expect(isBinary).toBe(false)
        const frame = rawDataToString(message)
        receivedFrames.push(frame)
        socket.send(`unix:${frame}`)
      })
    })
    await new Promise<void>((resolvePromise, reject) => {
      unixHttpServer.listen(socketPath, (error?: Error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      })
    })

    const daemonTarget = {
      kind: 'codex-daemon' as const,
      transport: 'unix-socket' as const,
      socketPath,
      ownedByCodori: false as const,
      cliVersion: '0.145.0',
      appServerVersion: '0.145.0'
    }
    const invalidateRuntimeTarget = vi.fn()
    const app = await createHttpServer(createManager({
      getProjectBridgeTarget: () => ({
        target: daemonTarget,
        workspacePath: '/tmp/demo'
      }),
      invalidateRuntimeTarget
    }))
    startedApps.push(app)
    await app.listen({
      host: '127.0.0.1',
      port: 0
    })

    const serverAddress = app.addresses()[0]
    const client = new WebSocket(
      `ws://127.0.0.1:${serverAddress.port}/api/projects/demo/rpc`
    )
    const prettyPrintedRequest = JSON.stringify({
      id: 'pretty',
      method: 'test/pretty',
      params: {
        enabled: true
      }
    }, null, 2)
    await new Promise<void>((resolvePromise, reject) => {
      client.once('open', () => client.send(prettyPrintedRequest))
      client.once('message', (message: WebSocket.RawData) => {
        try {
          expect(rawDataToString(message)).toBe(`unix:${prettyPrintedRequest}`)
          resolvePromise()
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      client.once('error', reject)
    })

    expect(receivedFrames).toEqual([prettyPrintedRequest])
    const clientClosed = new Promise<void>((resolvePromise) => {
      client.once('close', () => resolvePromise())
    })
    closeUpstream()
    await clientClosed
    expect(invalidateRuntimeTarget).toHaveBeenCalledWith(daemonTarget)
  })

  it('handles Codori avatar RPC locally without leaking internal requests', async () => {
    const backend = new WebSocketServer({
      host: '127.0.0.1',
      port: 0
    })
    startedSocketServers.push(backend)
    await new Promise<void>((resolvePromise) => {
      backend.once('listening', resolvePromise)
    })
    const address = backend.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get test server address.')
    }

    const backendMethods: string[] = []
    backend.on('connection', (socket: WebSocket) => {
      socket.on('message', (message: WebSocket.RawData) => {
        const payload = JSON.parse(rawDataToString(message)) as {
          id?: string | number
          method?: string
          params?: { watchId?: string }
        }
        if (payload.method) {
          backendMethods.push(payload.method)
        }
        if (payload.method === 'initialize') {
          socket.send(JSON.stringify({
            id: payload.id,
            result: {
              codexHome: '/tmp/codori-avatar-home',
              userAgent: 'codex-test'
            }
          }))
          return
        }
        if (payload.method === 'config/read') {
          socket.send(JSON.stringify({
            id: payload.id,
            result: {
              config: {
                desktop: {
                  'selected-avatar-id': 'codex'
                }
              }
            }
          }))
          return
        }
        if (payload.method === 'fs/watch' || payload.method === 'fs/unwatch') {
          socket.send(JSON.stringify({
            id: payload.id,
            result: {}
          }))
        }
      })
    })

    const avatarBytes = Buffer.from('avatar-sprite')
    const invalidate = vi.fn()
    const avatarResolver = {
      serverId: () => 'server-test',
      invalidate,
      resolve: async () => ({
        metadata: {
          serverId: 'server-test',
          serverLabel: 'test-host',
          avatarId: 'builtin:codex',
          source: 'builtin',
          displayName: 'Codex',
          description: 'The original Codex companion',
          revision: 'revision-test',
          mimeType: 'image/webp',
          frame: {
            width: 192,
            height: 208,
            columns: 8,
            rows: 9,
            frameCount: 72
          },
          animations: {
            idle: {
              frames: [{ spriteIndex: 0, durationMs: 1000 }],
              loopStart: 0,
              fallback: 'idle'
            }
          }
        },
        bytes: avatarBytes,
        watchPath: null
      })
    } as unknown as ServerAvatarResolver
    const app = await createHttpServer(createManager({
      startProject: () => ({
        ...createProjectRecord(),
        port: address.port,
        reusedExisting: true
      } satisfies StartProjectResult)
    }), {
      avatarResolver
    })
    startedApps.push(app)
    await app.listen({ host: '127.0.0.1', port: 0 })
    const serverAddress = app.addresses()[0]
    const client = new WebSocket(
      `ws://127.0.0.1:${serverAddress.port}/api/projects/demo/rpc`
    )
    const pending = new Map<string | number, {
      resolve: (payload: Record<string, unknown>) => void
      reject: (error: Error) => void
    }>()
    client.on('message', (message: WebSocket.RawData) => {
      const payload = JSON.parse(rawDataToString(message)) as Record<string, unknown>
      const id = payload.id
      if ((typeof id === 'string' || typeof id === 'number') && pending.has(id)) {
        pending.get(id)!.resolve(payload)
        pending.delete(id)
      }
    })
    await new Promise<void>((resolvePromise, reject) => {
      client.once('open', resolvePromise)
      client.once('error', reject)
    })
    const request = (
      id: string | number,
      method: string,
      params?: unknown
    ) => new Promise<Record<string, unknown>>((resolvePromise, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Timed out waiting for ${method}.`))
      }, 2000)
      pending.set(id, {
        resolve: (payload) => {
          clearTimeout(timer)
          resolvePromise(payload)
        },
        reject
      })
      client.send(JSON.stringify({ id, method, ...(params === undefined ? {} : { params }) }))
    })

    expect(await request(1, 'initialize', {})).toMatchObject({
      result: {
        codexHome: '/tmp/codori-avatar-home'
      }
    })
    client.send(JSON.stringify({ method: 'initialized' }))

    expect(await request(2, 'codori/avatar/read')).toMatchObject({
      result: {
        avatar: {
          serverId: 'server-test',
          avatarId: 'builtin:codex',
          revision: 'revision-test'
        }
      }
    })
    expect(await request(3, 'codori/avatar/sprites', {
      avatarId: 'builtin:codex',
      revision: 'revision-test'
    })).toEqual({
      id: 3,
      result: {
        avatarId: 'builtin:codex',
        revision: 'revision-test',
        mimeType: 'image/webp',
        data: avatarBytes.toString('base64')
      }
    })
    expect(await request(4, 'codori/avatar/unknown')).toMatchObject({
      error: {
        code: -32601
      }
    })
    expect(backendMethods).toContain('config/read')
    expect(backendMethods).not.toContain('codori/avatar/read')
    expect(backendMethods).not.toContain('codori/avatar/sprites')
    expect(backendMethods).not.toContain('codori/avatar/unknown')
    expect(invalidate).not.toHaveBeenCalled()
    client.close()
  })

  it('bridges project and chat websocket routes to the same runtime port', async () => {
    const backend = new WebSocketServer({
      host: '127.0.0.1',
      port: 0
    })
    startedSocketServers.push(backend)
    await new Promise<void>((resolvePromise) => {
      backend.once('listening', () => {
        resolvePromise()
      })
    })
    const address = backend.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to get test server address.')
    }
    const backendPort = address.port
    backend.on('connection', (socket: WebSocket) => {
      socket.on('message', (message: WebSocket.RawData) => {
        socket.send(`shared:${rawDataToString(message)}`)
      })
    })

    const starts: string[] = []
    const manager = createManager({
      startProject: () => {
        starts.push('project')
        return {
          ...createProjectRecord(),
          port: backendPort,
          reusedExisting: true
        } satisfies StartProjectResult
      },
      startChatSession: () => {
        starts.push('chat')
        return {
          ...createChatRecord(),
          port: backendPort,
          reusedExisting: true
        } satisfies StartChatSessionResult
      }
    })
    const app = await createHttpServer(manager)
    startedApps.push(app)
    await app.listen({
      host: '127.0.0.1',
      port: 0
    })

    const serverAddress = app.addresses()[0]
    const sendAndRead = async (url: string, message: string) => await new Promise<string>((resolvePromise, reject) => {
      const client = new WebSocket(url)
      client.once('open', () => {
        client.send(message)
      })
      client.once('message', (data: WebSocket.RawData) => {
        try {
          resolvePromise(rawDataToString(data))
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        } finally {
          client.close()
        }
      })
      client.once('error', reject)
    })

    await expect(sendAndRead(
      `ws://127.0.0.1:${serverAddress.port}/api/projects/demo/rpc`,
      'project'
    )).resolves.toBe('shared:project')
    await expect(sendAndRead(
      `ws://127.0.0.1:${serverAddress.port}/api/chats/chat-test/rpc`,
      'chat'
    )).resolves.toBe('shared:chat')
    expect(starts).toEqual(['project', 'chat'])
  })

  it('marks websocket sessions active while the proxy is connected', async () => {
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
        socket.send(rawDataToString(message))
      })
    })

    const events: string[] = []
    const manager = createManager({
      startProject: () => ({
        ...createProjectRecord(),
        port: backendPort,
        reusedExisting: true
      } satisfies StartProjectResult),
      acquireProjectSession: () => {
        events.push('acquire')
        return {
          touchActivity: () => {
            events.push('touch')
          },
          release: () => {
            events.push('release')
          }
        }
      },
      noteProjectActivity: () => {
        throw new Error('websocket activity should use the cached session context')
      }
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
      client.once('message', () => {
        client.close()
      })
      client.once('close', async () => {
        try {
          await new Promise(resolvePromise => setTimeout(resolvePromise, 0))
          expect(events[0]).toBe('acquire')
          expect(events).toContain('touch')
          expect(events.at(-1)).toBe('release')
          resolvePromise()
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
      client.once('error', reject)
    })
  })

  it('swallows rejected background activity updates in websocket handlers', async () => {
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
      } satisfies StartProjectResult),
      acquireProjectSession: () => ({
        touchActivity: async () => {
          throw new Error('disk write failed')
        },
        release: () => {}
      })
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

  it('persists uploaded attachments and serves previews', async () => {
    const attachmentsRoot = mkdtempSync(join(os.tmpdir(), 'codori-attachments-'))
    attachmentsRoots.push(attachmentsRoot)
    const app = await createHttpServer(createManager(), {
      attachmentsRootDir: attachmentsRoot
    })
    startedApps.push(app)

    const boundary = '----codori-test-boundary'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="threadId"',
      '',
      'thread-123',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="diagram.png"',
      'Content-Type: image/png',
      '',
      'PNGDATA',
      `--${boundary}--`,
      ''
    ].join('\r\n')

    const uploadResponse = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/attachments',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: body
    })

    expect(uploadResponse.statusCode).toBe(200)
    const uploadJson = uploadResponse.json() as {
      threadId: string
      files: Array<{ filename: string, mediaType: string | null, path: string }>
    }
    expect(uploadJson.threadId).toBe('thread-123')
    expect(uploadJson.files).toHaveLength(1)
    expect(uploadJson.files[0]?.filename).toBe('diagram.png')
    expect(uploadJson.files[0]?.mediaType).toBe('image/png')
    expect(readFileSync(uploadJson.files[0]!.path, 'utf8')).toBe('PNGDATA')
    expect(uploadJson.files[0]!.path.startsWith(resolveProjectAttachmentsDir('/tmp/demo', attachmentsRoot))).toBe(true)

    const fileResponse = await app.inject({
      method: 'GET',
      url: `/api/projects/demo/attachments/file?path=${encodeURIComponent(uploadJson.files[0]!.path)}`
    })

    expect(fileResponse.statusCode).toBe(200)
    expect(fileResponse.headers['content-type']).toContain('image/png')
    expect(fileResponse.body).toBe('PNGDATA')
  })

  it('rejects non-image attachments before persisting', async () => {
    const attachmentsRoot = mkdtempSync(join(os.tmpdir(), 'codori-attachments-'))
    attachmentsRoots.push(attachmentsRoot)
    const app = await createHttpServer(createManager(), {
      attachmentsRootDir: attachmentsRoot
    })
    startedApps.push(app)

    const boundary = '----codori-test-boundary'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="threadId"',
      '',
      'thread-123',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="payload.html"',
      'Content-Type: text/html',
      '',
      '<script>alert(1)</script>',
      `--${boundary}--`,
      ''
    ].join('\r\n')

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/attachments',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: body
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: {
        code: 'INVALID_ATTACHMENT',
        message: 'Only image attachments are supported.',
        details: null
      }
    })
  })

  it('rejects uploads that declare a non-image mime type even if the filename looks like an image', async () => {
    const attachmentsRoot = mkdtempSync(join(os.tmpdir(), 'codori-attachments-'))
    attachmentsRoots.push(attachmentsRoot)
    const app = await createHttpServer(createManager(), {
      attachmentsRootDir: attachmentsRoot
    })
    startedApps.push(app)

    const boundary = '----codori-test-boundary'
    const body = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="threadId"',
      '',
      'thread-123',
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="diagram.png"',
      'Content-Type: text/html',
      '',
      '<script>alert(1)</script>',
      `--${boundary}--`,
      ''
    ].join('\r\n')

    const response = await app.inject({
      method: 'POST',
      url: '/api/projects/demo/attachments',
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`
      },
      payload: body
    })

    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({
      error: {
        code: 'INVALID_ATTACHMENT',
        message: 'Only image attachments are supported.',
        details: null
      }
    })
  })

  it('rejects attachment preview paths outside the project attachment root', async () => {
    const attachmentsRoot = mkdtempSync(join(os.tmpdir(), 'codori-attachments-'))
    attachmentsRoots.push(attachmentsRoot)
    const app = await createHttpServer(createManager(), {
      attachmentsRootDir: attachmentsRoot
    })
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/demo/attachments/file?path=${encodeURIComponent('/tmp/not-allowed.png')}&mediaType=image%2Fpng`
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Invalid attachment path.'
      }
    })
  })

  it('rejects inline previews for non-image files even when stored under the attachment root', async () => {
    const attachmentsRoot = mkdtempSync(join(os.tmpdir(), 'codori-attachments-'))
    attachmentsRoots.push(attachmentsRoot)
    const projectRoot = resolveProjectAttachmentsDir('/tmp/demo', attachmentsRoot)
    const filePath = join(projectRoot, 'thread', 'payload.html')
    mkdirSync(join(projectRoot, 'thread'), { recursive: true })
    writeFileSync(filePath, '<script>alert(1)</script>', { encoding: 'utf8', flag: 'w' })

    const app = await createHttpServer(createManager(), {
      attachmentsRootDir: attachmentsRoot
    })
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/demo/attachments/file?path=${encodeURIComponent(filePath)}`
    })

    expect(response.statusCode).toBe(415)
    expect(response.json()).toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Attachment preview is only available for image files.'
      }
    })
  })

  it('returns a read-only preview for text files inside the active project root', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-local-file-'))
    tempDirs.push(projectPath)
    const filePath = join(projectPath, 'src', 'viewer.ts')
    mkdirSync(join(projectPath, 'src'), { recursive: true })
    writeFileSync(filePath, 'export const viewer = true\n', 'utf8')

    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/demo/local-file?path=${encodeURIComponent(filePath)}`
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      file: {
        kind: 'text',
        path: expect.stringMatching(/src\/viewer\.ts$/),
        relativePath: 'src/viewer.ts',
        name: 'viewer.ts',
        size: 'export const viewer = true\n'.length,
        updatedAt: expect.any(Number),
        text: 'export const viewer = true\n'
      }
    })
  })

  it('returns an inline image preview payload for project local image files', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-local-file-'))
    tempDirs.push(projectPath)
    const filePath = join(projectPath, 'assets', 'pixel.png')
    const imageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    mkdirSync(join(projectPath, 'assets'), { recursive: true })
    writeFileSync(filePath, imageBuffer)

    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/demo/local-file?path=${encodeURIComponent(filePath)}`
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      file: {
        kind: 'image',
        path: expect.stringMatching(/assets\/pixel\.png$/),
        relativePath: 'assets/pixel.png',
        name: 'pixel.png',
        size: imageBuffer.length,
        updatedAt: expect.any(Number),
        mediaType: 'image/png',
        base64: imageBuffer.toString('base64')
      }
    })
  })

  it('rejects local image previews when file contents are not a valid image', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-local-file-'))
    tempDirs.push(projectPath)
    const filePath = join(projectPath, 'assets', 'not-an-image.png')
    mkdirSync(join(projectPath, 'assets'), { recursive: true })
    writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03]))

    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/demo/local-file?path=${encodeURIComponent(filePath)}`
    })

    expect(response.statusCode).toBe(415)
    expect(response.json()).toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Local image preview is only available for valid PNG, JPEG, GIF, WebP, or SVG files.'
      }
    })
  })

  it('rejects local image previews when text files are renamed with image extensions', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-local-file-'))
    tempDirs.push(projectPath)
    const filePath = join(projectPath, 'assets', 'not-an-image.png')
    mkdirSync(join(projectPath, 'assets'), { recursive: true })
    writeFileSync(filePath, '<html>not an image</html>\n', 'utf8')

    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/demo/local-file?path=${encodeURIComponent(filePath)}`
    })

    expect(response.statusCode).toBe(415)
    expect(response.json()).toEqual({
      error: {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Local image preview is only available for valid PNG, JPEG, GIF, WebP, or SVG files.'
      }
    })
  })

  it('returns an inline image preview payload for chat local image files', async () => {
    const chatPath = mkdtempSync(join(os.tmpdir(), 'codori-local-chat-file-'))
    tempDirs.push(chatPath)
    const filePath = join(chatPath, 'screenshots', 'preview.png')
    const imageBuffer = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    )
    mkdirSync(join(chatPath, 'screenshots'), { recursive: true })
    writeFileSync(filePath, imageBuffer)

    const app = await createHttpServer(createManager({
      getChatStatus: () => ({
        ...createChatRecord(),
        chatPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/chats/chat-test/local-file?path=${encodeURIComponent(filePath)}`
    })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      file: {
        kind: 'image',
        path: expect.stringMatching(/screenshots\/preview\.png$/),
        relativePath: 'screenshots/preview.png',
        name: 'preview.png',
        size: imageBuffer.length,
        updatedAt: expect.any(Number),
        mediaType: 'image/png',
        base64: imageBuffer.toString('base64')
      }
    })
  })

  it('rejects local file previews outside the active project root', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-local-file-'))
    tempDirs.push(projectPath)
    const outsidePath = join(os.tmpdir(), 'codori-local-file-outside.txt')
    writeFileSync(outsidePath, 'outside\n', 'utf8')
    tempDirs.push(outsidePath)

    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/demo/local-file?path=${encodeURIComponent(outsidePath)}`
    })

    expect(response.statusCode).toBe(403)
    expect(response.json()).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'Local file access is limited to the active project root.'
      }
    })
  })

  it('rejects binary local file previews', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-local-file-'))
    tempDirs.push(projectPath)
    const filePath = join(projectPath, 'dist', 'blob.bin')
    mkdirSync(join(projectPath, 'dist'), { recursive: true })
    writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02]))

    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: `/api/projects/demo/local-file?path=${encodeURIComponent(filePath)}`
    })

    expect(response.statusCode).toBe(415)
    expect(response.json()).toEqual({
      error: {
        code: 'BINARY',
        message: 'Binary files are not supported by the local file viewer.'
      }
    })
  })

  it('rejects oversized local files without reading beyond the preview bound', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-local-file-'))
    tempDirs.push(projectPath)
    writeFileSync(join(projectPath, 'large.txt'), Buffer.alloc(MAX_LOCAL_FILE_VIEW_BYTES + 1, 0x61))
    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/demo/local-file?path=large.txt'
    })

    expect(response.statusCode).toBe(415)
    expect(response.json()).toMatchObject({
      error: { code: 'TOO_LARGE' }
    })
  })

  it('rejects named pipes without blocking the preview worker', async () => {
    if (process.platform === 'win32') {
      return
    }

    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-local-file-'))
    tempDirs.push(projectPath)
    execFileSync('mkfifo', [join(projectPath, 'preview.pipe')])
    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/demo/local-file?path=preview.pipe'
    })

    expect(response.statusCode).toBe(404)
    expect(response.json()).toMatchObject({
      error: { code: 'NOT_A_FILE' }
    })
  })

  it('lists bounded root-relative project directories without exposing absolute paths', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-project-files-'))
    tempDirs.push(projectPath)
    mkdirSync(join(projectPath, 'src'))
    mkdirSync(join(projectPath, 'node_modules'))
    writeFileSync(join(projectPath, 'README.md'), '# Demo\n', 'utf8')

    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/demo/files'
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({
      directory: {
        path: '',
        truncated: false,
        limit: 200,
        entries: [
          { name: 'src', path: 'src', kind: 'directory' },
          { name: 'README.md', path: 'README.md', kind: 'file' }
        ]
      }
    })
    expect(JSON.stringify(response.json())).not.toContain(projectPath)
  })

  it('provides matching nested directory listing and relative preview routes for chats', async () => {
    const chatPath = mkdtempSync(join(os.tmpdir(), 'codori-chat-files-'))
    tempDirs.push(chatPath)
    mkdirSync(join(chatPath, 'notes'))
    writeFileSync(join(chatPath, 'notes', 'today.md'), '# Today\n', 'utf8')

    const app = await createHttpServer(createManager({
      getChatStatus: () => ({
        ...createChatRecord(),
        chatPath
      })
    }))
    startedApps.push(app)

    const listingResponse = await app.inject({
      method: 'GET',
      url: '/api/chats/chat-test/files?path=notes'
    })
    expect(listingResponse.statusCode).toBe(200)
    expect(listingResponse.json()).toMatchObject({
      directory: {
        path: 'notes',
        entries: [
          { name: 'today.md', path: 'notes/today.md', kind: 'file' }
        ]
      }
    })

    const previewResponse = await app.inject({
      method: 'GET',
      url: '/api/chats/chat-test/local-file?path=notes%2Ftoday.md'
    })
    expect(previewResponse.statusCode).toBe(200)
    expect(previewResponse.json()).toMatchObject({
      file: {
        kind: 'text',
        relativePath: 'notes/today.md',
        text: '# Today\n'
      }
    })
  })

  it('rejects traversal and absolute injection in project directory routes', async () => {
    const projectPath = mkdtempSync(join(os.tmpdir(), 'codori-project-files-'))
    tempDirs.push(projectPath)
    const app = await createHttpServer(createManager({
      getProjectStatus: () => ({
        ...createProjectRecord(),
        projectPath
      })
    }))
    startedApps.push(app)

    for (const path of ['../outside', '/tmp/outside']) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/projects/demo/files?path=${encodeURIComponent(path)}`
      })

      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({
        error: { code: 'FORBIDDEN' }
      })
    }
  })
})

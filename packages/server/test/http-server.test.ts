import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { createServer as createNetServer } from 'node:net'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket, { WebSocketServer } from 'ws'
import { resolveProjectAttachmentsDir } from '../src/attachment-store.js'
import { createHttpServer, type RuntimeManagerLike } from '../src/http-server.js'
import type { ServiceUpdateController } from '../src/service-update.js'
import type { ProjectStatusRecord, StartProjectResult } from '../src/types.js'

const startedApps: Array<Awaited<ReturnType<typeof createHttpServer>>> = []
const startedSocketServers: WebSocketServer[] = []
const occupiedTcpServers: Array<ReturnType<typeof createNetServer>> = []
const attachmentsRoots: string[] = []

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

  for (const root of attachmentsRoots.splice(0, attachmentsRoots.length)) {
    await rm(root, { recursive: true, force: true })
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
      projects: [createProjectRecord()],
      serviceUpdate: {
        enabled: false,
        updateAvailable: false,
        updating: false,
        installedVersion: null,
        latestVersion: null
      }
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
      url: '/api/projects'
    })
    expect(listResponse.statusCode).toBe(200)
    expect(listResponse.json()).toEqual({
      projects: [createProjectRecord()],
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

  it('serves the bundled client and falls back to index.html for app routes', async () => {
    const bundleDir = mkdtempSync(join(os.tmpdir(), 'codori-ui-'))
    writeFileSync(join(bundleDir, 'index.html'), '<html><body>codori ui</body></html>')
    writeFileSync(join(bundleDir, 'asset.txt'), 'static asset')

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
})

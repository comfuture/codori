import { createServer } from 'node:net'
import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { createRuntimeManager } from '../src/process-manager.js'
import { RuntimeStore } from '../src/runtime-store.js'

const runningManagers: Array<ReturnType<typeof createRuntimeManager>> = []
const occupiedServers: Array<ReturnType<typeof createServer>> = []

afterEach(async () => {
  for (const manager of runningManagers.splice(0, runningManagers.length)) {
    const projects = [
      ...manager.listProjects().map(project => project.id),
      ...manager.listProjectlessStatuses().map(project => project.projectId)
    ]
    for (const projectId of projects) {
      await manager.stopProject(projectId)
    }
    manager.dispose()
  }

  for (const server of occupiedServers.splice(0, occupiedServers.length)) {
    await new Promise<void>((resolvePromise, reject) => {
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      })
    })
  }
})

const createFixture = () => {
  const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
  const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
  mkdirSync(join(root, 'demo', '.git'), { recursive: true })
  const documentsDir = join(homeDir, 'Documents')

  const config = resolveConfig({
    root
  }, homeDir)

  return {
    homeDir,
    documentsDir,
    root,
    config
  }
}

const listenOnPort = (server: ReturnType<typeof createServer>, port: number) =>
  new Promise<void>((resolvePromise, reject) => {
    server.listen(port, '0.0.0.0', (error?: Error) => {
      if (error) {
        reject(error)
        return
      }

      resolvePromise()
    })
  })

const closeServer = (server: ReturnType<typeof createServer>) =>
  new Promise<void>((resolvePromise, reject) => {
    server.close((error) => {
      if (error) {
        reject(error)
        return
      }

      resolvePromise()
    })
  })

const reservePortRange = async (size: number, start = 47000, end = 49000) => {
  for (let candidate = start; candidate <= end - size + 1; candidate += 1) {
    const probes = Array.from({ length: size }, () => createServer())

    try {
      for (const [index, probe] of probes.entries()) {
        await listenOnPort(probe, candidate + index)
      }

      return candidate
    } catch {
      // Try the next port range.
    } finally {
      await Promise.allSettled(probes.map(probe => closeServer(probe)))
    }
  }

  throw new Error('Failed to reserve a free TCP port range for the runtime-manager test.')
}

describe('RuntimeManager', () => {
  it('starts once and reuses the existing process', async () => {
    const fixture = createFixture()
    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      config: fixture.config,
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })
    runningManagers.push(manager)

    const started = await manager.startProject('demo')
    const reused = await manager.startProject('demo')

    expect(started.status).toBe('running')
    expect(reused.reusedExisting).toBe(true)
    expect(reused.port).toBe(started.port)
  })

  it('cleans a stale pid file before starting', async () => {
    const fixture = createFixture()
    const store = new RuntimeStore(fixture.homeDir)
    store.write({
      projectId: 'demo',
      projectPath: join(fixture.root, 'demo'),
      pid: 999999,
      port: 46000,
      startedAt: Date.now(),
      lastActivityAt: Date.now()
    })

    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      config: fixture.config,
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })
    runningManagers.push(manager)

    const started = await manager.startProject('demo')
    expect(started.status).toBe('running')
    expect(started.pid).not.toBe(999999)
  })

  it('skips occupied ports while allocating a runtime port', async () => {
    const fixture = createFixture()
    const startPort = await reservePortRange(3)
    const busyServer = createServer()
    occupiedServers.push(busyServer)
    await listenOnPort(busyServer, startPort)

    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      config: {
        ...fixture.config,
        ports: {
          start: startPort,
          end: startPort + 2
        }
      },
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })
    runningManagers.push(manager)

    const started = await manager.startProject('demo')
    expect(started.port).toBe(startPort + 1)
  })

  it('tracks runtime activity and reaps only idle runtimes without active sessions', async () => {
    const fixture = createFixture()
    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      config: {
        ...fixture.config,
        idleShutdown: {
          enabled: true,
          timeoutMs: 50,
          sweepIntervalMs: 10_000
        }
      },
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })
    runningManagers.push(manager)

    const started = await manager.startProject('demo')
    expect(started.lastActivityAt).not.toBeNull()

    const store = new RuntimeStore(fixture.homeDir)
    const loaded = store.load(join(fixture.root, 'demo'))
    expect(loaded.kind).toBe('valid')
    if (loaded.kind !== 'valid') {
      throw new Error('Expected a valid runtime record.')
    }

    const session = manager.acquireProjectSession('demo')
    const refreshed = store.load(join(fixture.root, 'demo'))
    expect(refreshed.kind).toBe('valid')
    if (refreshed.kind !== 'valid') {
      throw new Error('Expected a refreshed runtime record.')
    }

    store.write({
      ...refreshed.record,
      lastActivityAt: Date.now() - 5_000
    })

    const skipped = await manager.reapIdleRuntimes()
    expect(skipped).toBe(0)
    expect(manager.getProjectStatus('demo').status).toBe('running')

    session.release()
    const reaped = await manager.reapIdleRuntimes()
    expect(reaped).toBe(1)
    expect(manager.getProjectStatus('demo').status).toBe('stopped')
  })

  it('updates the last activity timestamp when project activity is noted', async () => {
    const fixture = createFixture()
    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      config: fixture.config,
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })
    runningManagers.push(manager)

    await manager.startProject('demo')
    const store = new RuntimeStore(fixture.homeDir)
    const loaded = store.load(join(fixture.root, 'demo'))
    expect(loaded.kind).toBe('valid')
    if (loaded.kind !== 'valid') {
      throw new Error('Expected a valid runtime record.')
    }

    store.write({
      ...loaded.record,
      lastActivityAt: loaded.record.startedAt - 1_000
    })

    const touched = manager.noteProjectActivity('demo')
    expect(touched.lastActivityAt).toBeGreaterThan(loaded.record.startedAt - 1_000)
    expect(touched.idleDeadlineAt).toBe(
      touched.lastActivityAt === null
        ? null
        : touched.lastActivityAt + fixture.config.idleShutdown.timeoutMs
    )
  })

  it('creates and starts a projectless chat under the current user documents directory', async () => {
    const fixture = createFixture()
    const spawnedCwds: string[] = []
    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      documentsDir: fixture.documentsDir,
      config: fixture.config,
      commandFactory: (_port, project) => {
        spawnedCwds.push(project.path)
        return {
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)']
        }
      }
    })
    runningManagers.push(manager)

    const created = await manager.createProjectlessChat()

    expect(created.status).toBe('running')
    expect(created.reusedExisting).toBe(false)
    expect(created.title).toBe('New Chat')
    expect(created.workspaceKind).toBe('projectless')
    expect(created.projectId).toMatch(/^projectless\/chat-/)
    expect(created.projectPath.startsWith(join(fixture.documentsDir, 'Codex'))).toBe(true)
    expect(spawnedCwds).toEqual([created.projectPath])

    const recent = manager.listProjectlessStatuses()
    expect(recent).toHaveLength(1)
    expect(recent[0]?.projectId).toBe(created.projectId)
    expect(recent[0]?.title).toBe('New Chat')
    expect(recent[0]?.workspaceKind).toBe('projectless')
  })

  it('deletes a projectless chat and removes its scratch directory', async () => {
    const fixture = createFixture()
    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      documentsDir: fixture.documentsDir,
      config: fixture.config,
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })
    runningManagers.push(manager)

    const created = await manager.createProjectlessChat()
    const deleted = await manager.deleteProjectlessChat(created.projectId)

    expect(deleted).toEqual({
      projectId: created.projectId
    })
    expect(manager.listProjectlessStatuses()).toEqual([])
  })

  it('persists projectless chat title updates in the scratch marker', async () => {
    const fixture = createFixture()
    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      documentsDir: fixture.documentsDir,
      config: fixture.config,
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })
    runningManagers.push(manager)

    const created = await manager.createProjectlessChat()
    const updated = manager.updateProjectlessChatTitle(
      created.projectId,
      'Investigate projectless chat titles'
    )

    expect(updated.title).toBe('Investigate projectless chat titles')
    expect(manager.listProjectlessStatuses()[0]?.title).toBe('Investigate projectless chat titles')
  })
})

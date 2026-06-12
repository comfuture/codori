import { createServer } from 'node:net'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
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
      ...manager.listProjects().map(project => ({ kind: 'project' as const, id: project.id })),
      ...manager.listChatStatuses().map(chat => ({ kind: 'chat' as const, id: chat.chatId }))
    ]
    for (const workspace of projects) {
      if (workspace.kind === 'chat') {
        await manager.stopChatSession(workspace.id)
      } else {
        await manager.stopProject(workspace.id)
      }
    }
    await manager.resetStoredRuntimes()
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
  mkdirSync(join(root, 'other', '.git'), { recursive: true })
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

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

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

const waitForFile = async (path: string, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      return
    }

    await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
  }

  throw new Error(`Timed out waiting for ${path}.`)
}

const waitForCondition = async (condition: () => boolean, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) {
      return
    }

    await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
  }

  throw new Error('Timed out waiting for condition.')
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
    const other = await manager.startProject('other')

    expect(started.status).toBe('running')
    expect(reused.reusedExisting).toBe(true)
    expect(reused.port).toBe(started.port)
    expect(other.reusedExisting).toBe(true)
    expect(other.pid).toBe(started.pid)
    expect(other.port).toBe(started.port)
  })

  it('deduplicates concurrent starts across workspaces', async () => {
    const fixture = createFixture()
    let commandCalls = 0
    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      documentsDir: fixture.documentsDir,
      config: fixture.config,
      commandFactory: () => {
        commandCalls += 1
        return {
          command: process.execPath,
          args: ['-e', 'setInterval(() => {}, 1000)']
        }
      }
    })
    runningManagers.push(manager)

    const [demo, other, chat] = await Promise.all([
      manager.startProject('demo'),
      manager.startProject('other'),
      manager.createChatSession()
    ])

    expect(commandCalls).toBe(1)
    expect(other.reusedExisting).toBe(true)
    expect(chat.reusedExisting).toBe(true)
    expect(other.pid).toBe(demo.pid)
    expect(chat.pid).toBe(demo.pid)
    expect(other.port).toBe(demo.port)
    expect(chat.port).toBe(demo.port)
  })

  it('starts the default app-server command on loopback from the configured root', async () => {
    const fixture = createFixture()
    const capturePath = join(fixture.homeDir, 'codex-spawn.json')
    const fakeCodexPath = join(fixture.homeDir, 'fake-codex.cjs')
    writeFileSync(fakeCodexPath, [
      '#!/usr/bin/env node',
      "const { writeFileSync } = require('node:fs')",
      'writeFileSync(process.env.CODORI_CAPTURE_PATH, JSON.stringify({',
      '  argv: process.argv.slice(2),',
      '  cwd: process.cwd()',
      '}))',
      'setInterval(() => {}, 1000)'
    ].join('\n'))
    chmodSync(fakeCodexPath, 0o755)
    const previousCodexBin = process.env.CODORI_CODEX_BIN
    const previousCapturePath = process.env.CODORI_CAPTURE_PATH
    process.env.CODORI_CODEX_BIN = fakeCodexPath
    process.env.CODORI_CAPTURE_PATH = capturePath

    try {
      const manager = createRuntimeManager({
        homeDir: fixture.homeDir,
        config: fixture.config
      })
      runningManagers.push(manager)

      const started = await manager.startProject('demo')
      await waitForFile(capturePath)
      const capture = JSON.parse(readFileSync(capturePath, 'utf8')) as {
        argv: string[]
        cwd: string
      }

      expect(realpathSync(capture.cwd)).toBe(realpathSync(fixture.root))
      expect(capture.argv).toEqual([
        'app-server',
        '--listen',
        `ws://127.0.0.1:${started.port}`
      ])
    } finally {
      if (previousCodexBin === undefined) {
        delete process.env.CODORI_CODEX_BIN
      } else {
        process.env.CODORI_CODEX_BIN = previousCodexBin
      }
      if (previousCapturePath === undefined) {
        delete process.env.CODORI_CAPTURE_PATH
      } else {
        process.env.CODORI_CAPTURE_PATH = previousCapturePath
      }
    }
  })

  it('cleans a stale pid file before starting', async () => {
    const fixture = createFixture()
    const store = new RuntimeStore(fixture.homeDir)
    store.write({
      projectId: 'codori:shared-app-server',
      projectPath: fixture.root,
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

  it('clears stale workspace activity when the shared runtime dies before restart', async () => {
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

    const demo = await manager.startProject('demo')
    expect(demo.pid).not.toBeNull()
    if (demo.pid === null) {
      throw new Error('Expected a started shared runtime PID.')
    }
    const demoPid = demo.pid
    process.kill(demoPid, 'SIGTERM')
    await waitForCondition(() => !isProcessAlive(demoPid))

    expect(manager.getProjectStatus('demo').status).toBe('stopped')

    const other = await manager.startProject('other')
    expect(other.status).toBe('running')
    expect(other.reusedExisting).toBe(false)
    expect(manager.getProjectStatus('demo').status).toBe('stopped')
  })

  it('resets stored runtimes before a new server starts', async () => {
    const fixture = createFixture()
    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      config: fixture.config,
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })

    const started = await manager.startProject('demo')
    expect(started.pid).not.toBeNull()
    expect(started.reusedExisting).toBe(false)
    if (started.pid === null) {
      throw new Error('Expected a started runtime PID.')
    }
    expect(isProcessAlive(started.pid)).toBe(true)
    manager.dispose()

    const nextManager = createRuntimeManager({
      homeDir: fixture.homeDir,
      config: fixture.config,
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })
    runningManagers.push(nextManager)

    const stopped = await nextManager.resetStoredRuntimes()
    expect(stopped).toBe(1)
    expect(isProcessAlive(started.pid)).toBe(false)

    const store = new RuntimeStore(fixture.homeDir)
    expect(store.load(fixture.root).kind).toBe('missing')

    const restarted = await nextManager.startProject('demo')
    expect(restarted.reusedExisting).toBe(false)
    expect(restarted.pid).not.toBe(started.pid)
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
    const loaded = store.load(fixture.root)
    expect(loaded.kind).toBe('valid')
    if (loaded.kind !== 'valid') {
      throw new Error('Expected a valid runtime record.')
    }

    const session = manager.acquireProjectSession('demo')
    const refreshed = store.load(fixture.root)
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

  it('keeps the shared runtime alive when one of multiple workspaces is stopped', async () => {
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

    const project = await manager.startProject('demo')
    const chat = await manager.createChatSession()

    expect(project.pid).not.toBeNull()
    expect(chat.pid).toBe(project.pid)
    expect(chat.port).toBe(project.port)
    if (project.pid === null) {
      throw new Error('Expected a started shared runtime PID.')
    }

    const stoppedProject = await manager.stopProject('demo')

    expect(stoppedProject.status).toBe('stopped')
    expect(stoppedProject.pid).toBeNull()
    expect(isProcessAlive(project.pid)).toBe(true)
    expect(manager.getChatStatus(chat.chatId).status).toBe('running')
    expect(manager.getChatStatus(chat.chatId).pid).toBe(project.pid)
  })

  it('stops the shared runtime when the final workspace is stopped', async () => {
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

    const project = await manager.startProject('demo')
    expect(project.pid).not.toBeNull()
    if (project.pid === null) {
      throw new Error('Expected a started shared runtime PID.')
    }

    const stoppedProject = await manager.stopProject('demo')

    expect(stoppedProject.status).toBe('stopped')
    expect(isProcessAlive(project.pid)).toBe(false)
    expect(new RuntimeStore(fixture.homeDir).load(fixture.root).kind).toBe('missing')
  })

  it('stops the shared runtime after the final stopped workspace session closes', async () => {
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

    const project = await manager.startProject('demo')
    expect(project.pid).not.toBeNull()
    if (project.pid === null) {
      throw new Error('Expected a started shared runtime PID.')
    }
    const projectPid = project.pid

    const session = manager.acquireProjectSession('demo')
    const stoppedProject = await manager.stopProject('demo')

    expect(stoppedProject.status).toBe('stopped')
    expect(isProcessAlive(projectPid)).toBe(true)

    session.release()

    const store = new RuntimeStore(fixture.homeDir)
    await waitForCondition(() => !isProcessAlive(projectPid) && store.load(fixture.root).kind === 'missing')

    const restarted = await manager.startProject('demo')
    expect(restarted.status).toBe('running')
    expect(restarted.reusedExisting).toBe(false)
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
    const loaded = store.load(fixture.root)
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

  it('creates and starts a chat under the current user Documents/Chats directory', async () => {
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

    const created = await manager.createChatSession()
    const second = await manager.createChatSession()

    expect(created.status).toBe('running')
    expect(created.reusedExisting).toBe(false)
    expect(created.title).toBe('New Chat')
    expect(created.chatId).toMatch(/^chat-/)
    expect(created.chatPath.startsWith(join(fixture.documentsDir, 'Chats'))).toBe(true)
    expect(second.status).toBe('running')
    expect(second.reusedExisting).toBe(true)
    expect(second.pid).toBe(created.pid)
    expect(second.port).toBe(created.port)
    expect(spawnedCwds).toEqual([fixture.root])

    const recent = manager.listChatStatuses()
    expect(recent).toHaveLength(2)
    expect(recent.some(chat => chat.chatId === created.chatId && chat.title === 'New Chat')).toBe(true)
    expect(recent.some(chat => chat.chatId === second.chatId && chat.title === 'New Chat')).toBe(true)
  })

  it('deletes a chat and removes its scratch directory', async () => {
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

    const created = await manager.createChatSession()
    const deleted = await manager.deleteChatSession(created.chatId)

    expect(deleted).toEqual({
      chatId: created.chatId
    })
    expect(manager.listChatStatuses()).toEqual([])
  })

  it('persists chat title and thread updates in the scratch marker', async () => {
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

    const created = await manager.createChatSession()
    const titled = await manager.updateChatSessionTitle(
      created.chatId,
      'Investigate chat titles'
    )
    const threaded = await manager.updateChatSessionThread(created.chatId, 'thread-1')
    const cleared = await manager.updateChatSessionThread(created.chatId, null)

    expect(titled.title).toBe('Investigate chat titles')
    expect(threaded.threadId).toBe('thread-1')
    expect(cleared.threadId).toBeNull()
    expect(manager.listChatStatuses()[0]?.title).toBe('Investigate chat titles')
    expect(manager.listChatStatuses()[0]?.threadId).toBeNull()
  })
})

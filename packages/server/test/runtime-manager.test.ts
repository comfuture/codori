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
    for (const project of manager.listProjects()) {
      await manager.stopProject(project.id)
    }
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

  const config = resolveConfig({
    root
  }, homeDir)

  return {
    homeDir,
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
      startedAt: Date.now()
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
})

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
    const busyServer = createServer()
    occupiedServers.push(busyServer)
    await new Promise<void>((resolvePromise, reject) => {
      busyServer.listen(46000, '0.0.0.0', (error?: Error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      })
    })

    const manager = createRuntimeManager({
      homeDir: fixture.homeDir,
      config: {
        ...fixture.config,
        ports: {
          start: 46000,
          end: 46002
        }
      },
      commandFactory: () => ({
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)']
      })
    })
    runningManagers.push(manager)

    const started = await manager.startProject('demo')
    expect(started.port).toBe(46001)
  })
})

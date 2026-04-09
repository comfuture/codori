import { spawn, type ChildProcess } from 'node:child_process'
import os from 'node:os'
import { resolveConfig } from './config.js'
import { CodoriError } from './errors.js'
import { findAvailablePort } from './ports.js'
import { scanProjects } from './project-scanner.js'
import { RuntimeStore } from './runtime-store.js'
import type {
  CodoriConfig,
  ConfigOverrides,
  ProjectRecord,
  ProjectStatusRecord,
  RuntimeRecord,
  StartProjectResult
} from './types.js'

type CommandFactory = (port: number, project: ProjectRecord) => {
  command: string
  args: string[]
}

type RuntimeManagerOptions = {
  homeDir?: string
  configOverrides?: ConfigOverrides
  config?: CodoriConfig
  commandFactory?: CommandFactory
}

const CODORI_STOP_TIMEOUT_MS = 3_000
const CODORI_STOP_POLL_MS = 50

const defaultCommandFactory: CommandFactory = (port) => ({
  command: process.env.CODORI_CODEX_BIN ?? 'codex',
  args: ['app-server', '--listen', `ws://0.0.0.0:${port}`]
})

const isProcessAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const wait = async (ms: number) =>
  new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms)
  })

const waitForExit = async (pid: number, timeoutMs: number) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true
    }
    await wait(CODORI_STOP_POLL_MS)
  }
  return !isProcessAlive(pid)
}

const spawnDetached = async (command: string, args: string[], cwd: string) =>
  new Promise<ChildProcess>((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    })

    child.once('error', reject)
    child.once('spawn', () => {
      child.unref()
      resolvePromise(child)
    })
  })

export class RuntimeManager {
  readonly config: CodoriConfig

  readonly store: RuntimeStore

  private readonly commandFactory: CommandFactory

  constructor(options: RuntimeManagerOptions = {}) {
    this.config = options.config ?? resolveConfig(options.configOverrides, options.homeDir)
    this.store = new RuntimeStore(options.homeDir)
    this.commandFactory = options.commandFactory ?? defaultCommandFactory
  }

  listProjects() {
    return scanProjects(this.config.root)
  }

  private resolveProject(projectId: string) {
    const project = this.listProjects().find(entry => entry.id === projectId)
    if (!project) {
      throw new CodoriError('PROJECT_NOT_FOUND', `Project "${projectId}" was not found under ${this.config.root}.`)
    }
    return project
  }

  private normalizeStatus(project: ProjectRecord, runtime: RuntimeRecord | null, error: string | null): ProjectStatusRecord {
    return {
      projectId: project.id,
      projectPath: project.path,
      status: error ? 'error' : runtime ? 'running' : 'stopped',
      pid: runtime?.pid ?? null,
      port: runtime?.port ?? null,
      startedAt: runtime?.startedAt ?? null,
      error
    }
  }

  private readRunningRuntime(project: ProjectRecord) {
    const loaded = this.store.load(project.path)
    if (loaded.kind === 'missing') {
      return this.normalizeStatus(project, null, null)
    }

    if (loaded.kind === 'invalid') {
      return this.normalizeStatus(project, null, loaded.error)
    }

    if (!isProcessAlive(loaded.record.pid)) {
      this.store.remove(project.path)
      return this.normalizeStatus(project, null, null)
    }

    return this.normalizeStatus(project, loaded.record, null)
  }

  listProjectStatuses() {
    return this.listProjects().map(project => this.readRunningRuntime(project))
  }

  getProjectStatus(projectId: string) {
    return this.readRunningRuntime(this.resolveProject(projectId))
  }

  async startProject(projectId: string): Promise<StartProjectResult> {
    const project = this.resolveProject(projectId)
    const loaded = this.store.load(project.path)

    if (loaded.kind === 'valid' && isProcessAlive(loaded.record.pid)) {
      return {
        ...this.normalizeStatus(project, loaded.record, null),
        reusedExisting: true
      }
    }

    if (loaded.kind !== 'missing') {
      this.store.remove(project.path)
    }

    const port = await findAvailablePort(this.config.ports.start, this.config.ports.end)
    const command = this.commandFactory(port, project)
    const child = await spawnDetached(command.command, command.args, project.path)

    if (typeof child.pid !== 'number') {
      throw new CodoriError('PROCESS_START_FAILED', `Failed to determine PID for project "${projectId}".`)
    }

    const runtime: RuntimeRecord = {
      projectId: project.id,
      projectPath: project.path,
      pid: child.pid,
      port,
      startedAt: Date.now()
    }
    this.store.write(runtime)

    return {
      ...this.normalizeStatus(project, runtime, null),
      reusedExisting: false
    }
  }

  async stopProject(projectId: string) {
    const project = this.resolveProject(projectId)
    const loaded = this.store.load(project.path)

    if (loaded.kind === 'missing') {
      return this.normalizeStatus(project, null, null)
    }

    if (loaded.kind === 'invalid') {
      this.store.remove(project.path)
      return this.normalizeStatus(project, null, null)
    }

    if (isProcessAlive(loaded.record.pid)) {
      process.kill(loaded.record.pid, 'SIGTERM')
      const exited = await waitForExit(loaded.record.pid, CODORI_STOP_TIMEOUT_MS)
      if (!exited) {
        process.kill(loaded.record.pid, 'SIGKILL')
        await waitForExit(loaded.record.pid, CODORI_STOP_TIMEOUT_MS)
      }
    }

    this.store.remove(project.path)
    return this.normalizeStatus(project, null, null)
  }
}

export const createRuntimeManager = (options: RuntimeManagerOptions = {}) =>
  new RuntimeManager({
    homeDir: options.homeDir ?? os.homedir(),
    configOverrides: options.configOverrides,
    config: options.config,
    commandFactory: options.commandFactory
  })

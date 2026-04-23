import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { resolveConfig } from './config.js'
import { CodoriError } from './errors.js'
import { cloneProjectIntoRoot } from './git.js'
import { findAvailablePort } from './ports.js'
import { scanProjects } from './project-scanner.js'
import { RuntimeStore } from './runtime-store.js'
import type {
  CodoriConfig,
  ConfigOverrides,
  DeleteProjectlessChatResult,
  ProjectRecord,
  ProjectStatusRecord,
  RuntimeRecord,
  StartProjectResult,
  UpdateProjectlessChatTitleResult
} from './types.js'

type CommandFactory = (port: number, project: ProjectRecord) => {
  command: string
  args: string[]
}

type ProjectSessionLease = {
  touchActivity: (at?: number) => ProjectStatusRecord
  release: () => void
}

type RuntimeManagerOptions = {
  homeDir?: string
  documentsDir?: string
  configOverrides?: ConfigOverrides
  config?: CodoriConfig
  commandFactory?: CommandFactory
}

const CODORI_STOP_TIMEOUT_MS = 3_000
const CODORI_STOP_POLL_MS = 50
const PROJECTLESS_PARENT_DIR_NAME = 'Codex'
const PROJECTLESS_PROJECT_ID_PREFIX = 'projectless/'
const PROJECTLESS_MARKER_FILE = '.codori-projectless.json'
const PROJECTLESS_RECENT_LIMIT = 5
const DEFAULT_PROJECTLESS_CHAT_TITLE = 'New Chat'

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

  private readonly documentsDir: string

  private readonly commandFactory: CommandFactory

  private readonly activeSessions = new Map<string, number>()

  private idleReaper: NodeJS.Timeout | null = null

  private idleSweepInFlight = false

  constructor(options: RuntimeManagerOptions = {}) {
    this.config = options.config ?? resolveConfig(options.configOverrides, options.homeDir)
    this.store = new RuntimeStore(options.homeDir)
    this.documentsDir = options.documentsDir ?? join(options.homeDir ?? os.homedir(), 'Documents')
    this.commandFactory = options.commandFactory ?? defaultCommandFactory

    if (this.config.idleShutdown.enabled) {
      this.idleReaper = setInterval(() => {
        void this.reapIdleRuntimes()
      }, this.config.idleShutdown.sweepIntervalMs)
      this.idleReaper.unref?.()
    }
  }

  listProjects() {
    return scanProjects(this.config.root)
  }

  private getProjectlessRoot() {
    return join(this.documentsDir, PROJECTLESS_PARENT_DIR_NAME)
  }

  private readProjectlessProject(projectPath: string): ProjectRecord | null {
    const markerPath = join(projectPath, PROJECTLESS_MARKER_FILE)
    if (!existsSync(markerPath)) {
      return null
    }

    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as {
        projectId?: unknown
        title?: unknown
        createdAt?: unknown
      }
      if (typeof marker.projectId !== 'string' || !marker.projectId.startsWith(PROJECTLESS_PROJECT_ID_PREFIX)) {
        return null
      }

      return {
        id: marker.projectId,
        path: projectPath,
        title: typeof marker.title === 'string' && marker.title.trim()
          ? marker.title.trim()
          : DEFAULT_PROJECTLESS_CHAT_TITLE,
        workspaceKind: 'projectless',
        createdAt: typeof marker.createdAt === 'number' ? marker.createdAt : null
      }
    } catch {
      return null
    }
  }

  private listProjectlessProjects(limit = PROJECTLESS_RECENT_LIMIT) {
    const root = this.getProjectlessRoot()
    if (!existsSync(root)) {
      return []
    }

    const projects: ProjectRecord[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const projectPath = join(root, entry.name)
      try {
        if (!statSync(projectPath).isDirectory()) {
          continue
        }
      } catch {
        continue
      }

      const project = this.readProjectlessProject(projectPath)
      if (project) {
        projects.push(project)
      }
    }

    return projects
      .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0))
      .slice(0, limit)
  }

  private createProjectlessProjectRecord() {
    const now = Date.now()
    const stamp = new Date(now).toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, '')
      .replace('T', '-')
    const slug = `chat-${stamp}-${randomUUID().slice(0, 8)}`
    const projectPath = join(this.getProjectlessRoot(), slug)
    const projectId = `${PROJECTLESS_PROJECT_ID_PREFIX}${slug}`

    mkdirSync(projectPath, { recursive: true })
    writeFileSync(join(projectPath, PROJECTLESS_MARKER_FILE), `${JSON.stringify({
      projectId,
      title: DEFAULT_PROJECTLESS_CHAT_TITLE,
      createdAt: now
    }, null, 2)}\n`)

    return {
      id: projectId,
      path: projectPath,
      title: DEFAULT_PROJECTLESS_CHAT_TITLE,
      workspaceKind: 'projectless' as const,
      createdAt: now
    }
  }

  private writeProjectlessMarker(project: ProjectRecord) {
    writeFileSync(join(project.path, PROJECTLESS_MARKER_FILE), `${JSON.stringify({
      projectId: project.id,
      title: project.title ?? DEFAULT_PROJECTLESS_CHAT_TITLE,
      createdAt: project.createdAt ?? Date.now()
    }, null, 2)}\n`)
  }

  private resolveProject(projectId: string) {
    const project = this.listProjects().find(entry => entry.id === projectId)
    if (project) {
      return project
    }

    const projectlessProject = this.listProjectlessProjects(Number.POSITIVE_INFINITY)
      .find(entry => entry.id === projectId)
    if (projectlessProject) {
      return projectlessProject
    }

    throw new CodoriError('PROJECT_NOT_FOUND', `Project "${projectId}" was not found under ${this.config.root} or ${this.getProjectlessRoot()}.`)
  }

  private normalizeStatus(project: ProjectRecord, runtime: RuntimeRecord | null, error: string | null): ProjectStatusRecord {
    const activeSessionCount = this.getActiveSessionCount(project.id)
    return {
      projectId: project.id,
      projectPath: project.path,
      title: project.title ?? null,
      workspaceKind: project.workspaceKind ?? 'project',
      createdAt: project.createdAt ?? null,
      status: error ? 'error' : runtime ? 'running' : 'stopped',
      pid: runtime?.pid ?? null,
      port: runtime?.port ?? null,
      startedAt: runtime?.startedAt ?? null,
      lastActivityAt: runtime?.lastActivityAt ?? null,
      activeSessionCount,
      idleTimeoutMs: this.config.idleShutdown.enabled ? this.config.idleShutdown.timeoutMs : null,
      idleDeadlineAt: this.resolveIdleDeadline(runtime, activeSessionCount),
      error
    }
  }

  private getActiveSessionCount(projectId: string) {
    return this.activeSessions.get(projectId) ?? 0
  }

  private resolveIdleDeadline(runtime: RuntimeRecord | null, activeSessionCount: number) {
    if (!runtime || !this.config.idleShutdown.enabled || activeSessionCount > 0) {
      return null
    }

    return runtime.lastActivityAt + this.config.idleShutdown.timeoutMs
  }

  private writeRuntime(record: RuntimeRecord) {
    this.store.write(record)
    return record
  }

  private touchRuntimeRecord(record: RuntimeRecord, at = Date.now()) {
    return this.writeRuntime({
      ...record,
      lastActivityAt: Math.max(record.lastActivityAt, at)
    })
  }

  private incrementActiveSessions(projectId: string) {
    this.activeSessions.set(projectId, this.getActiveSessionCount(projectId) + 1)
  }

  private decrementActiveSessions(projectId: string) {
    const next = this.getActiveSessionCount(projectId) - 1
    if (next > 0) {
      this.activeSessions.set(projectId, next)
      return
    }

    this.activeSessions.delete(projectId)
  }

  private loadActiveRuntime(project: ProjectRecord) {
    const loaded = this.store.load(project.path)

    if (loaded.kind === 'missing') {
      return null
    }

    if (loaded.kind === 'invalid') {
      this.store.remove(project.path)
      return null
    }

    if (!isProcessAlive(loaded.record.pid)) {
      this.store.remove(project.path)
      return null
    }

    return loaded.record
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

  private touchProjectRuntime(project: ProjectRecord, at = Date.now()) {
    const runtime = this.loadActiveRuntime(project)
    if (!runtime) {
      return this.normalizeStatus(project, null, null)
    }

    return this.normalizeStatus(project, this.touchRuntimeRecord(runtime, at), null)
  }

  noteProjectActivity(projectId: string, at = Date.now()) {
    return this.touchProjectRuntime(this.resolveProject(projectId), at)
  }

  acquireProjectSession(projectId: string): ProjectSessionLease {
    const project = this.resolveProject(projectId)
    this.incrementActiveSessions(project.id)
    this.touchProjectRuntime(project)

    let released = false
    return {
      touchActivity: (at = Date.now()) => this.touchProjectRuntime(project, at),
      release: () => {
        if (released) {
          return
        }

        released = true
        this.decrementActiveSessions(project.id)
      }
    }
  }

  listProjectStatuses() {
    return this.listProjects().map(project => this.readRunningRuntime(project))
  }

  listProjectlessStatuses() {
    return this.listProjectlessProjects(PROJECTLESS_RECENT_LIMIT)
      .map(project => this.readRunningRuntime(project))
  }

  getProjectStatus(projectId: string) {
    return this.readRunningRuntime(this.resolveProject(projectId))
  }

  async cloneProject(input: { repositoryUrl: string, destination?: string | null }) {
    const clonedProject = await cloneProjectIntoRoot({
      rootDirectory: this.config.root,
      repositoryUrl: input.repositoryUrl,
      destination: input.destination
    })

    return this.getProjectStatus(clonedProject.projectId)
  }

  async startProject(projectId: string): Promise<StartProjectResult> {
    const project = this.resolveProject(projectId)
    return await this.startResolvedProject(project)
  }

  private async startResolvedProject(project: ProjectRecord): Promise<StartProjectResult> {
    const loaded = this.store.load(project.path)

    if (loaded.kind === 'valid' && isProcessAlive(loaded.record.pid)) {
      const runtime = this.touchRuntimeRecord(loaded.record)
      return {
        ...this.normalizeStatus(project, runtime, null),
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
      throw new CodoriError('PROCESS_START_FAILED', `Failed to determine PID for project "${project.id}".`)
    }

    const now = Date.now()
    const runtime: RuntimeRecord = {
      projectId: project.id,
      projectPath: project.path,
      pid: child.pid,
      port,
      startedAt: now,
      lastActivityAt: now
    }
    this.writeRuntime(runtime)

    return {
      ...this.normalizeStatus(project, runtime, null),
      reusedExisting: false
    }
  }

  async createProjectlessChat(): Promise<StartProjectResult> {
    return await this.startResolvedProject(this.createProjectlessProjectRecord())
  }

  async deleteProjectlessChat(projectId: string): Promise<DeleteProjectlessChatResult> {
    const project = this.resolveProject(projectId)
    if (project.workspaceKind !== 'projectless') {
      throw new CodoriError(
        'PROJECT_DELETE_UNAVAILABLE',
        'Only projectless chats can be deleted through this endpoint.'
      )
    }

    await this.stopProject(projectId)
    this.activeSessions.delete(projectId)
    rmSync(project.path, { recursive: true, force: true })

    return { projectId }
  }

  updateProjectlessChatTitle(projectId: string, title: string): UpdateProjectlessChatTitleResult {
    const project = this.resolveProject(projectId)
    if (project.workspaceKind !== 'projectless') {
      throw new CodoriError(
        'PROJECT_TITLE_UPDATE_UNAVAILABLE',
        'Only projectless chats can be titled through this endpoint.'
      )
    }

    const nextTitle = title.trim()
    if (!nextTitle) {
      throw new CodoriError('INVALID_PROJECT_TITLE', 'Projectless chat title must not be empty.')
    }

    const updatedProject: ProjectRecord = {
      ...project,
      title: nextTitle
    }
    this.writeProjectlessMarker(updatedProject)
    return this.getProjectStatus(projectId)
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

  async reapIdleRuntimes() {
    if (!this.config.idleShutdown.enabled || this.idleSweepInFlight) {
      return 0
    }

    this.idleSweepInFlight = true
    let stopped = 0

    try {
      const now = Date.now()
      for (const project of [
        ...this.listProjects(),
        ...this.listProjectlessProjects(Number.POSITIVE_INFINITY)
      ]) {
        const runtime = this.loadActiveRuntime(project)
        if (!runtime) {
          continue
        }

        if (this.getActiveSessionCount(project.id) > 0) {
          continue
        }

        if (now - runtime.lastActivityAt < this.config.idleShutdown.timeoutMs) {
          continue
        }

        await this.stopProject(project.id)
        stopped += 1
      }

      return stopped
    } finally {
      this.idleSweepInFlight = false
    }
  }

  dispose() {
    if (!this.idleReaper) {
      return
    }

    clearInterval(this.idleReaper)
    this.idleReaper = null
  }
}

export const createRuntimeManager = (options: RuntimeManagerOptions = {}) =>
  new RuntimeManager({
    homeDir: options.homeDir ?? os.homedir(),
    documentsDir: options.documentsDir,
    configOverrides: options.configOverrides,
    config: options.config,
    commandFactory: options.commandFactory
  })

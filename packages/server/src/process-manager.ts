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
  ChatSessionRecord,
  ChatSessionStatusRecord,
  CodoriConfig,
  ConfigOverrides,
  DeleteChatSessionResult,
  ProjectRecord,
  ProjectStatusRecord,
  RuntimeRecord,
  StartChatSessionResult,
  StartProjectResult,
  UpdateChatSessionThreadResult,
  UpdateChatSessionTitleResult
} from './types.js'

type CommandFactory = (port: number, project: ProjectRecord) => {
  command: string
  args: string[]
}

type RuntimeSessionLease<T> = {
  touchActivity: (at?: number) => T
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
const CHAT_PARENT_DIR_NAME = 'Chats'
const CHAT_MARKER_FILE = '.codori-chat.json'
const CHAT_RECENT_LIMIT = 5
const CHAT_RUNTIME_ID_PREFIX = 'chat:'
const DEFAULT_CHAT_TITLE = 'New Chat'

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

  private getChatsRoot() {
    return join(this.documentsDir, CHAT_PARENT_DIR_NAME)
  }

  private readChatSession(chatPath: string): ChatSessionRecord | null {
    const markerPath = join(chatPath, CHAT_MARKER_FILE)
    if (!existsSync(markerPath)) {
      return null
    }

    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as {
        chatId?: unknown
        threadId?: unknown
        title?: unknown
        createdAt?: unknown
        updatedAt?: unknown
      }
      if (typeof marker.chatId !== 'string' || !marker.chatId.startsWith('chat-')) {
        return null
      }

      return {
        chatId: marker.chatId,
        chatPath,
        threadId: typeof marker.threadId === 'string' && marker.threadId.trim()
          ? marker.threadId.trim()
          : null,
        title: typeof marker.title === 'string' && marker.title.trim()
          ? marker.title.trim()
          : DEFAULT_CHAT_TITLE,
        createdAt: typeof marker.createdAt === 'number' ? marker.createdAt : 0,
        updatedAt: typeof marker.updatedAt === 'number' ? marker.updatedAt : null
      }
    } catch {
      return null
    }
  }

  private listChatSessions(limit = CHAT_RECENT_LIMIT) {
    const root = this.getChatsRoot()
    if (!existsSync(root)) {
      return []
    }

    const chats: ChatSessionRecord[] = []
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue
      }

      const chatPath = join(root, entry.name)
      try {
        if (!statSync(chatPath).isDirectory()) {
          continue
        }
      } catch {
        continue
      }

      const chat = this.readChatSession(chatPath)
      if (chat) {
        chats.push(chat)
      }
    }

    return chats
      .sort((left, right) => (right.updatedAt ?? right.createdAt) - (left.updatedAt ?? left.createdAt))
      .slice(0, limit)
  }

  private createChatSessionRecord() {
    const now = Date.now()
    const stamp = new Date(now).toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, '')
      .replace('T', '-')
    const chatId = `chat-${stamp}-${randomUUID().slice(0, 8)}`
    const chatPath = join(this.getChatsRoot(), chatId)

    mkdirSync(chatPath, { recursive: true })
    const chat: ChatSessionRecord = {
      chatId,
      chatPath,
      threadId: null,
      title: DEFAULT_CHAT_TITLE,
      createdAt: now,
      updatedAt: now
    }
    this.writeChatSessionMarker(chat)

    return chat
  }

  private writeChatSessionMarker(chat: ChatSessionRecord) {
    writeFileSync(join(chat.chatPath, CHAT_MARKER_FILE), `${JSON.stringify({
      chatId: chat.chatId,
      threadId: chat.threadId,
      title: chat.title ?? DEFAULT_CHAT_TITLE,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt ?? Date.now()
    }, null, 2)}\n`)
  }

  private resolveChatSession(chatId: string) {
    const chat = this.listChatSessions(Number.POSITIVE_INFINITY)
      .find(entry => entry.chatId === chatId)
    if (chat) {
      return chat
    }

    throw new CodoriError('CHAT_NOT_FOUND', `Chat "${chatId}" was not found under ${this.getChatsRoot()}.`)
  }

  private chatRuntimeId(chatId: string) {
    return `${CHAT_RUNTIME_ID_PREFIX}${chatId}`
  }

  private chatToRuntimeProject(chat: ChatSessionRecord): ProjectRecord {
    return {
      id: this.chatRuntimeId(chat.chatId),
      path: chat.chatPath
    }
  }

  private resolveProject(projectId: string) {
    const project = this.listProjects().find(entry => entry.id === projectId)
    if (project) {
      return project
    }

    throw new CodoriError('PROJECT_NOT_FOUND', `Project "${projectId}" was not found under ${this.config.root}.`)
  }

  private normalizeStatus(project: ProjectRecord, runtime: RuntimeRecord | null, error: string | null): ProjectStatusRecord {
    const activeSessionCount = this.getActiveSessionCount(project.id)
    return {
      projectId: project.id,
      projectPath: project.path,
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

  private normalizeChatStatus(
    chat: ChatSessionRecord,
    runtime: RuntimeRecord | null,
    error: string | null
  ): ChatSessionStatusRecord {
    const activeSessionCount = this.getActiveSessionCount(this.chatRuntimeId(chat.chatId))
    return {
      ...chat,
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

  noteChatActivity(chatId: string, at = Date.now()) {
    return this.touchChatRuntime(this.resolveChatSession(chatId), at)
  }

  acquireProjectSession(projectId: string): RuntimeSessionLease<ProjectStatusRecord> {
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

  acquireChatSession(chatId: string): RuntimeSessionLease<ChatSessionStatusRecord> {
    const chat = this.resolveChatSession(chatId)
    const runtimeProject = this.chatToRuntimeProject(chat)
    this.incrementActiveSessions(runtimeProject.id)
    this.touchProjectRuntime(runtimeProject)

    let released = false
    return {
      touchActivity: (at = Date.now()) => this.touchChatRuntime(chat, at),
      release: () => {
        if (released) {
          return
        }

        released = true
        this.decrementActiveSessions(runtimeProject.id)
      }
    }
  }

  listProjectStatuses() {
    return this.listProjects().map(project => this.readRunningRuntime(project))
  }

  listChatStatuses() {
    return this.listChatSessions(CHAT_RECENT_LIMIT)
      .map(chat => this.readRunningChatRuntime(chat))
  }

  getProjectStatus(projectId: string) {
    return this.readRunningRuntime(this.resolveProject(projectId))
  }

  getChatStatus(chatId: string) {
    return this.readRunningChatRuntime(this.resolveChatSession(chatId))
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

  private readRunningChatRuntime(chat: ChatSessionRecord) {
    const runtimeProject = this.chatToRuntimeProject(chat)
    const loaded = this.store.load(runtimeProject.path)
    if (loaded.kind === 'missing') {
      return this.normalizeChatStatus(chat, null, null)
    }

    if (loaded.kind === 'invalid') {
      return this.normalizeChatStatus(chat, null, loaded.error)
    }

    if (!isProcessAlive(loaded.record.pid)) {
      this.store.remove(runtimeProject.path)
      return this.normalizeChatStatus(chat, null, null)
    }

    return this.normalizeChatStatus(chat, loaded.record, null)
  }

  private touchChatRuntime(chat: ChatSessionRecord, at = Date.now()) {
    const runtimeProject = this.chatToRuntimeProject(chat)
    const runtime = this.loadActiveRuntime(runtimeProject)
    if (!runtime) {
      return this.normalizeChatStatus(chat, null, null)
    }

    return this.normalizeChatStatus(chat, this.touchRuntimeRecord(runtime, at), null)
  }

  async createChatSession(): Promise<StartChatSessionResult> {
    return await this.startChatSession(this.createChatSessionRecord().chatId)
  }

  async startChatSession(chatId: string): Promise<StartChatSessionResult> {
    const chat = this.resolveChatSession(chatId)
    const started = await this.startResolvedProject(this.chatToRuntimeProject(chat))
    return {
      ...this.getChatStatus(chatId),
      reusedExisting: started.reusedExisting
    }
  }

  async deleteChatSession(chatId: string): Promise<DeleteChatSessionResult> {
    const chat = this.resolveChatSession(chatId)
    await this.stopChatSession(chatId)
    this.activeSessions.delete(this.chatRuntimeId(chatId))
    rmSync(chat.chatPath, { recursive: true, force: true })

    return { chatId }
  }

  updateChatSessionTitle(chatId: string, title: string): UpdateChatSessionTitleResult {
    const chat = this.resolveChatSession(chatId)

    const nextTitle = title.trim()
    if (!nextTitle) {
      throw new CodoriError('INVALID_CHAT_TITLE', 'Chat title must not be empty.')
    }

    const updatedChat: ChatSessionRecord = {
      ...chat,
      title: nextTitle,
      updatedAt: Date.now()
    }
    this.writeChatSessionMarker(updatedChat)
    return this.getChatStatus(chatId)
  }

  updateChatSessionThread(chatId: string, threadId: string): UpdateChatSessionThreadResult {
    const chat = this.resolveChatSession(chatId)
    const nextThreadId = threadId.trim()
    if (!nextThreadId) {
      throw new CodoriError('MISSING_THREAD_ID', 'Missing thread id.')
    }

    const updatedChat: ChatSessionRecord = {
      ...chat,
      threadId: nextThreadId,
      updatedAt: Date.now()
    }
    this.writeChatSessionMarker(updatedChat)
    return this.getChatStatus(chatId)
  }

  async stopProject(projectId: string) {
    return await this.stopResolvedProject(this.resolveProject(projectId))
  }

  async stopChatSession(chatId: string) {
    const chat = this.resolveChatSession(chatId)
    await this.stopResolvedProject(this.chatToRuntimeProject(chat))
    return this.getChatStatus(chatId)
  }

  private async stopResolvedProject(project: ProjectRecord) {
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
        ...this.listChatSessions(Number.POSITIVE_INFINITY).map(chat => this.chatToRuntimeProject(chat))
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

        await this.stopResolvedProject(project)
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

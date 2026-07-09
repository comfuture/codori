import { spawn, type ChildProcess } from 'node:child_process'
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
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

type WorkspaceActivityRecord = {
  startedAt: number
  lastActivityAt: number
}

const CODORI_STOP_TIMEOUT_MS = 3_000
const CODORI_STOP_POLL_MS = 50
const CHAT_PARENT_DIR_NAME = 'Chats'
const CHAT_MARKER_FILE = '.codori-chat.json'
const CHAT_RECENT_LIMIT = 5
const CHAT_RUNTIME_ID_PREFIX = 'chat:'
const SHARED_RUNTIME_ID = 'codori:shared-app-server'
const DEFAULT_CHAT_TITLE = 'New Chat'
const require = createRequire(import.meta.url)

export const resolveCodexCommand = (
  port: number,
  codexBin = process.env.CODORI_CODEX_BIN
): ReturnType<CommandFactory> => {
  const args = ['app-server', '--listen', `ws://127.0.0.1:${port}`]
  if (codexBin) {
    return {
      command: codexBin,
      args
    }
  }

  return {
    command: process.execPath,
    args: [require.resolve('@openai/codex/bin/codex.js'), ...args]
  }
}

const defaultCommandFactory: CommandFactory = (port) => resolveCodexCommand(port)

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

const terminateProcess = async (pid: number) => {
  if (!isProcessAlive(pid)) {
    return false
  }

  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    return false
  }

  const exited = await waitForExit(pid, CODORI_STOP_TIMEOUT_MS)
  if (exited) {
    return true
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return true
  }

  await waitForExit(pid, CODORI_STOP_TIMEOUT_MS)
  return true
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

  private readonly workspaceActivity = new Map<string, WorkspaceActivityRecord>()

  private sharedRuntimeStart: Promise<StartProjectResult> | null = null

  private sharedRuntimeStop: Promise<boolean> | null = null

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

  private async createChatSessionRecord() {
    const now = Date.now()
    const stamp = new Date(now).toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, '')
      .replace('T', '-')
    const chatId = `chat-${stamp}-${randomUUID().slice(0, 8)}`
    const chatPath = join(this.getChatsRoot(), chatId)

    await mkdir(chatPath, { recursive: true })
    const chat: ChatSessionRecord = {
      chatId,
      chatPath,
      threadId: null,
      title: DEFAULT_CHAT_TITLE,
      createdAt: now,
      updatedAt: now
    }
    await this.writeChatSessionMarker(chat)

    return chat
  }

  private async writeChatSessionMarker(chat: ChatSessionRecord) {
    await writeFile(join(chat.chatPath, CHAT_MARKER_FILE), `${JSON.stringify({
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

  private sharedRuntimeProject(): ProjectRecord {
    return {
      id: SHARED_RUNTIME_ID,
      path: this.config.root
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
    const activity = this.workspaceActivity.get(project.id) ?? null
    const running = activity !== null && runtime !== null
    return {
      projectId: project.id,
      projectPath: project.path,
      status: error ? 'error' : running ? 'running' : 'stopped',
      pid: running ? runtime.pid : null,
      port: running ? runtime.port : null,
      startedAt: running ? activity.startedAt : null,
      lastActivityAt: running ? activity.lastActivityAt : null,
      activeSessionCount,
      idleTimeoutMs: this.config.idleShutdown.enabled ? this.config.idleShutdown.timeoutMs : null,
      idleDeadlineAt: this.resolveIdleDeadline(activity, activeSessionCount),
      error
    }
  }

  private normalizeChatStatus(
    chat: ChatSessionRecord,
    runtime: RuntimeRecord | null,
    error: string | null
  ): ChatSessionStatusRecord {
    const workspaceId = this.chatRuntimeId(chat.chatId)
    const activeSessionCount = this.getActiveSessionCount(workspaceId)
    const activity = this.workspaceActivity.get(workspaceId) ?? null
    const running = activity !== null && runtime !== null
    return {
      ...chat,
      status: error ? 'error' : running ? 'running' : 'stopped',
      pid: running ? runtime.pid : null,
      port: running ? runtime.port : null,
      startedAt: running ? activity.startedAt : null,
      lastActivityAt: running ? activity.lastActivityAt : null,
      activeSessionCount,
      idleTimeoutMs: this.config.idleShutdown.enabled ? this.config.idleShutdown.timeoutMs : null,
      idleDeadlineAt: this.resolveIdleDeadline(activity, activeSessionCount),
      error
    }
  }

  private getActiveSessionCount(projectId: string) {
    return this.activeSessions.get(projectId) ?? 0
  }

  private getTotalActiveSessionCount() {
    let total = 0
    for (const count of this.activeSessions.values()) {
      total += count
    }
    return total
  }

  private resolveIdleDeadline(activity: WorkspaceActivityRecord | null, activeSessionCount: number) {
    if (!activity || !this.config.idleShutdown.enabled || activeSessionCount > 0) {
      return null
    }

    return activity.lastActivityAt + this.config.idleShutdown.timeoutMs
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

  private activateWorkspace(workspaceId: string, at = Date.now()) {
    const activity = this.workspaceActivity.get(workspaceId)
    if (activity) {
      activity.lastActivityAt = Math.max(activity.lastActivityAt, at)
      return activity
    }

    const nextActivity = {
      startedAt: at,
      lastActivityAt: at
    }
    this.workspaceActivity.set(workspaceId, nextActivity)
    return nextActivity
  }

  private touchWorkspaceActivity(workspaceId: string, at = Date.now()) {
    const activity = this.workspaceActivity.get(workspaceId)
    if (!activity) {
      return null
    }

    activity.lastActivityAt = Math.max(activity.lastActivityAt, at)
    return activity
  }

  private deactivateWorkspace(workspaceId: string) {
    this.workspaceActivity.delete(workspaceId)
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

  private releaseWorkspaceSession(workspaceId: string) {
    this.decrementActiveSessions(workspaceId)
    void this.stopSharedRuntimeIfUnused().catch(() => {})
  }

  private removeSharedRuntime(project: ProjectRecord) {
    this.store.remove(project.path)
    this.workspaceActivity.clear()
  }

  private loadActiveRuntime() {
    const project = this.sharedRuntimeProject()
    const loaded = this.store.load(project.path)

    if (loaded.kind === 'missing') {
      return null
    }

    if (loaded.kind === 'invalid') {
      this.removeSharedRuntime(project)
      return null
    }

    if (!isProcessAlive(loaded.record.pid)) {
      this.removeSharedRuntime(project)
      return null
    }

    return loaded.record
  }

  private readSharedRuntime() {
    const project = this.sharedRuntimeProject()
    const loaded = this.store.load(project.path)
    if (loaded.kind === 'missing') {
      return {
        runtime: null,
        error: null
      }
    }

    if (loaded.kind === 'invalid') {
      return {
        runtime: null,
        error: loaded.error
      }
    }

    if (!isProcessAlive(loaded.record.pid)) {
      this.removeSharedRuntime(project)
      return {
        runtime: null,
        error: null
      }
    }

    return {
      runtime: loaded.record,
      error: null
    }
  }

  private readRunningRuntime(project: ProjectRecord) {
    const shared = this.readSharedRuntime()
    return this.normalizeStatus(project, shared.runtime, shared.error)
  }

  private touchProjectRuntime(project: ProjectRecord, at = Date.now()) {
    const runtime = this.loadActiveRuntime()
    if (!runtime) {
      return this.normalizeStatus(project, null, null)
    }

    this.touchWorkspaceActivity(project.id, at)
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
        this.releaseWorkspaceSession(project.id)
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
        this.releaseWorkspaceSession(runtimeProject.id)
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

  async resetStoredRuntimes() {
    const resetResults = await Promise.all(this.store.list().map(async (loaded): Promise<number> => {
      if (loaded.kind === 'invalid') {
        this.store.removePath(loaded.path)
        return 0
      }

      if (loaded.kind === 'missing') {
        return 0
      }

      const stopped = await terminateProcess(loaded.record.pid)
      this.store.removePath(loaded.path)
      return stopped ? 1 : 0
    }))

    this.activeSessions.clear()
    this.workspaceActivity.clear()
    return resetResults.reduce((total, stopped) => total + stopped, 0)
  }

  private async startResolvedProject(project: ProjectRecord): Promise<StartProjectResult> {
    const started = await this.startSharedRuntime(project)
    return {
      ...this.normalizeStatus(project, this.loadActiveRuntime(), null),
      reusedExisting: started.reusedExisting
    }
  }

  private async startSharedRuntime(workspace: ProjectRecord): Promise<StartProjectResult> {
    if (this.sharedRuntimeStop) {
      await this.sharedRuntimeStop
    }

    if (this.sharedRuntimeStart) {
      await this.sharedRuntimeStart
      const runtime = this.loadActiveRuntime()
      this.activateWorkspace(workspace.id)
      if (!runtime) {
        throw new CodoriError('PROCESS_START_FAILED', 'Shared app-server runtime did not start.')
      }
      return {
        ...this.normalizeStatus(workspace, this.touchRuntimeRecord(runtime), null),
        reusedExisting: true
      }
    }

    this.sharedRuntimeStart = this.startSharedRuntimeNow(workspace)
    try {
      return await this.sharedRuntimeStart
    } finally {
      this.sharedRuntimeStart = null
    }
  }

  private async startSharedRuntimeNow(workspace: ProjectRecord): Promise<StartProjectResult> {
    const runtimeProject = this.sharedRuntimeProject()
    const loaded = this.store.load(runtimeProject.path)

    if (loaded.kind === 'valid' && isProcessAlive(loaded.record.pid)) {
      const now = Date.now()
      this.activateWorkspace(workspace.id, now)
      const runtime = this.touchRuntimeRecord(loaded.record, now)
      return {
        ...this.normalizeStatus(workspace, runtime, null),
        reusedExisting: true
      }
    }

    if (loaded.kind !== 'missing') {
      this.removeSharedRuntime(runtimeProject)
    }

    const port = await findAvailablePort(this.config.ports.start, this.config.ports.end)
    const command = this.commandFactory(port, runtimeProject)
    const child = await spawnDetached(command.command, command.args, runtimeProject.path)

    if (typeof child.pid !== 'number') {
      throw new CodoriError('PROCESS_START_FAILED', 'Failed to determine PID for shared app-server runtime.')
    }

    const now = Date.now()
    const runtime: RuntimeRecord = {
      projectId: runtimeProject.id,
      projectPath: runtimeProject.path,
      pid: child.pid,
      port,
      startedAt: now,
      lastActivityAt: now
    }
    this.writeRuntime(runtime)
    this.activateWorkspace(workspace.id, now)

    return {
      ...this.normalizeStatus(workspace, runtime, null),
      reusedExisting: false
    }
  }

  private readRunningChatRuntime(chat: ChatSessionRecord) {
    const shared = this.readSharedRuntime()
    return this.normalizeChatStatus(chat, shared.runtime, shared.error)
  }

  private touchChatRuntime(chat: ChatSessionRecord, at = Date.now()) {
    const runtimeProject = this.chatToRuntimeProject(chat)
    const runtime = this.loadActiveRuntime()
    if (!runtime) {
      return this.normalizeChatStatus(chat, null, null)
    }

    this.touchWorkspaceActivity(runtimeProject.id, at)
    return this.normalizeChatStatus(chat, this.touchRuntimeRecord(runtime, at), null)
  }

  async createChatSession(): Promise<StartChatSessionResult> {
    return await this.startChatSession((await this.createChatSessionRecord()).chatId)
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
    await rm(chat.chatPath, { recursive: true, force: true })

    return { chatId }
  }

  async updateChatSessionTitle(chatId: string, title: string): Promise<UpdateChatSessionTitleResult> {
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
    await this.writeChatSessionMarker(updatedChat)
    return this.getChatStatus(chatId)
  }

  async updateChatSessionThread(chatId: string, threadId: string | null): Promise<UpdateChatSessionThreadResult> {
    const chat = this.resolveChatSession(chatId)
    const nextThreadId = typeof threadId === 'string' && threadId.trim()
      ? threadId.trim()
      : null

    const updatedChat: ChatSessionRecord = {
      ...chat,
      threadId: nextThreadId,
      updatedAt: Date.now()
    }
    await this.writeChatSessionMarker(updatedChat)
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
    this.deactivateWorkspace(project.id)
    await this.stopSharedRuntimeIfUnused()
    return this.normalizeStatus(project, null, null)
  }

  private async stopSharedRuntimeIfUnused() {
    if (
      this.workspaceActivity.size > 0
      || this.getTotalActiveSessionCount() > 0
      || this.sharedRuntimeStart
    ) {
      return false
    }

    if (this.sharedRuntimeStop) {
      return await this.sharedRuntimeStop
    }

    const stop = this.stopSharedRuntimeNow()
    this.sharedRuntimeStop = stop
    try {
      return await stop
    } finally {
      if (this.sharedRuntimeStop === stop) {
        this.sharedRuntimeStop = null
      }
    }
  }

  private async stopSharedRuntimeNow() {
    if (this.workspaceActivity.size > 0 || this.getTotalActiveSessionCount() > 0) {
      return false
    }

    const runtimeProject = this.sharedRuntimeProject()
    const runtime = this.loadActiveRuntime()
    if (!runtime) {
      return false
    }

    await terminateProcess(runtime.pid)
    this.store.remove(runtimeProject.path)
    return true
  }

  async reapIdleRuntimes() {
    if (!this.config.idleShutdown.enabled || this.idleSweepInFlight) {
      return 0
    }

    this.idleSweepInFlight = true
    let stopped = 0

    try {
      const runtimeProject = this.sharedRuntimeProject()
      const runtime = this.loadActiveRuntime()
      if (!runtime) {
        return 0
      }

      if (this.getTotalActiveSessionCount() > 0) {
        return 0
      }

      const now = Date.now()
      if (now - runtime.lastActivityAt >= this.config.idleShutdown.timeoutMs) {
        await terminateProcess(runtime.pid)
        this.store.remove(runtimeProject.path)
        this.workspaceActivity.clear()
        stopped = 1
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

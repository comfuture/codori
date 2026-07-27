import {
  notificationThreadId,
  type CodexRpcConnectionState,
  type CodexRpcNotification,
  CodexRpcClient
} from '@codori/client/shared/codex-rpc'
import type {
  Thread,
  ThreadReadResponse,
  ThreadResumeResponse
} from '@codori/client/shared/generated/codex-app-server/v2'
import {
  listAllThreadBackgroundTerminals,
  reconcileBackgroundTerminals,
  type BackgroundTerminalModel
} from '@codori/client/shared/background-terminals'
import {
  createRealtimeTranscriptState,
  reduceRealtimeTranscriptNotification,
  resetRealtimeTranscript,
  type RealtimeTranscriptState
} from '@codori/client/shared/realtime-transcript'
import {
  resolveWorkspaceRpcUrl,
  type WorkspaceIdentity
} from '@codori/client/shared/workspace'
import {
  createToolItemStore,
  normalizeToolItemPresentations,
  reduceToolItemNotification,
  type ToolItemPresentation,
  type ToolItemPresentationStatus,
  type ToolItemStore
} from '@codori/client/shared/tool-items'
import {
  BACKGROUND_TERMINAL_POLL_MS,
  MAX_PANEL_OUTPUT_CHARS
} from './config'
import {
  SpatialPanelModel,
  type SpatialPanelInput,
  type SpatialPanelSnapshot,
  type SpatialPanelStatus
} from './panel-model'
import type { RealtimeVisualActivity } from './light-model'

export type WorkspaceRuntimeSnapshot = {
  connection: CodexRpcConnectionState
  activity: RealtimeVisualActivity
  generation: number
  transcripts: RealtimeTranscriptState['segments']
  panels: SpatialPanelSnapshot[]
  error: string | null
  thread: Thread | null
}

export type WorkspaceRuntimeOptions = {
  identity: WorkspaceIdentity
  client?: CodexRpcClient
  wsBase?: string | null
  httpBase?: string | null
  now?: () => number
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
}

const panelStatus = (
  status: ToolItemPresentationStatus
): SpatialPanelStatus => {
  switch (status) {
    case 'running':
      return 'in-progress'
    case 'completed':
      return 'completed'
    case 'declined':
      return 'declined'
    default:
      return 'failed'
  }
}

const presentationKind = (
  kind: ToolItemPresentation['kind']
): SpatialPanelInput['kind'] => {
  switch (kind) {
    case 'command_execution':
      return 'command'
    case 'file_change':
      return 'file-change'
    case 'mcp_tool_call':
      return 'mcp-tool'
    case 'dynamic_tool_call':
      return 'dynamic-tool'
    case 'web_search':
      return 'web-search'
  }
}

const toolPanel = (
  presentation: ToolItemPresentation
): SpatialPanelInput => ({
  id: presentation.id,
  kind: presentationKind(presentation.kind),
  title: presentation.title,
  status: panelStatus(presentation.status),
  text: presentation.text,
  cwd: presentation.cwd,
  exitCode: presentation.exitCode,
  background: false
})

const backgroundPanel = (
  terminal: BackgroundTerminalModel,
  presentation?: ToolItemPresentation
): SpatialPanelInput => ({
  id: `background:${terminal.itemId}:${terminal.processId}`,
  kind: 'background-terminal',
  title: terminal.command || 'Background terminal',
  status: 'in-progress',
  text: [
    `process: ${terminal.processId}`,
    terminal.osPid == null ? null : `pid: ${terminal.osPid}`,
    terminal.cpuPercent == null ? null : `cpu: ${terminal.cpuPercent.toFixed(1)}%`,
    terminal.rssKb == null ? null : `rss: ${terminal.rssKb} KiB`,
    presentation?.text || null
  ].filter(Boolean).join('\n'),
  cwd: terminal.cwd,
  exitCode: presentation?.exitCode,
  background: true
})

export class WorkspaceRuntime {
  readonly client: CodexRpcClient

  private readonly now: () => number

  private readonly setInterval: typeof globalThis.setInterval

  private readonly clearInterval: typeof globalThis.clearInterval

  private readonly panelModel = new SpatialPanelModel()

  private toolStore: ToolItemStore = createToolItemStore()

  private readonly listeners = new Set<(snapshot: WorkspaceRuntimeSnapshot) => void>()

  private connection: CodexRpcConnectionState = 'idle'

  private activity: RealtimeVisualActivity = 'idle'

  private transcriptState = createRealtimeTranscriptState()

  private realtimeStarted = false

  private generation = 0

  private thread: Thread | null = null

  private error: string | null = null

  private backgroundTerminals: BackgroundTerminalModel[] = []

  private suspended = false

  private backgroundRefresh: Promise<void> | null = null

  private backgroundTimer: ReturnType<typeof globalThis.setInterval> | null = null

  private modelTimer: ReturnType<typeof globalThis.setInterval> | null = null

  private releaseNotification: (() => void) | null = null

  private releaseConnection: (() => void) | null = null

  constructor(private readonly options: WorkspaceRuntimeOptions) {
    this.now = options.now ?? (() => performance.now())
    this.setInterval = options.setInterval
      ?? globalThis.setInterval.bind(globalThis)
    this.clearInterval = options.clearInterval
      ?? globalThis.clearInterval.bind(globalThis)
    this.client = options.client ?? new CodexRpcClient(
      resolveWorkspaceRpcUrl({
        workspace: options.identity.workspace,
        configuredWsBase: options.wsBase,
        configuredHttpBase: options.httpBase
      })
    )
  }

  subscribe(listener: (snapshot: WorkspaceRuntimeSnapshot) => void) {
    this.listeners.add(listener)
    listener(this.snapshot())
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot(): WorkspaceRuntimeSnapshot {
    return {
      connection: this.connection,
      activity: this.activity,
      generation: this.generation,
      transcripts: [...this.transcriptState.segments],
      panels: this.panelModel.snapshots(),
      error: this.error,
      thread: this.thread
    }
  }

  private emit() {
    const snapshot = this.snapshot()
    for (const listener of this.listeners) {
      listener(snapshot)
    }
  }

  async start() {
    if (!this.releaseNotification) {
      this.releaseNotification = this.client.subscribe(notification => {
        this.handleNotification(notification)
      })
      this.releaseConnection = this.client.subscribeConnectionState(state => {
        this.connection = state
        if (state === 'disconnected') {
          this.error = 'The Codex connection disconnected. Return to 2D or retry the immersive workspace.'
          this.activity = 'error'
        }
        this.emit()
      })
    }
    await this.client.connect()
    await this.client.request<ThreadResumeResponse>(
      'thread/resume',
      {
        threadId: this.options.identity.threadId,
        excludeTurns: true
      }
    )
    const response = await this.client.request<ThreadReadResponse>(
      'thread/read',
      {
        threadId: this.options.identity.threadId,
        includeTurns: true
      }
    )
    if (response.thread.id !== this.options.identity.threadId) {
      throw new Error('The loaded thread does not match the immersive workspace identity.')
    }
    if (response.thread.ephemeral) {
      throw new Error('Immersive Codori requires a materialized thread.')
    }
    this.thread = response.thread
    this.seedRunningItems(response.thread)
    await this.refreshBackgroundTerminals()
    this.resumeTimers()
    this.emit()
  }

  private seedRunningItems(thread: Thread) {
    for (const turn of thread.turns) {
      for (const item of turn.items) {
        if (!('status' in item) || item.status !== 'inProgress') {
          continue
        }
        this.toolStore = reduceToolItemNotification(
          this.toolStore,
          {
            method: 'item/started',
            params: {
              threadId: thread.id,
              turnId: turn.id,
              item,
              startedAtMs: turn.startedAt === null
                ? this.now()
                : turn.startedAt * 1_000
            }
          } as CodexRpcNotification,
          { threadId: thread.id }
        )
      }
    }
    this.syncForegroundPanels()
  }

  private syncForegroundPanels() {
    const now = this.now()
    const presentations = normalizeToolItemPresentations(
      this.toolStore,
      {
        maximumCharacters: MAX_PANEL_OUTPUT_CHARS
      }
    )
    const backgroundItemIds = new Set(
      this.backgroundTerminals.map(terminal => terminal.itemId)
    )
    this.panelModel.reconcileForeground(
      presentations
        .filter(presentation => !backgroundItemIds.has(presentation.id))
        .map(toolPanel),
      now
    )
    this.syncBackgroundPanels(presentations, now)
  }

  private syncBackgroundPanels(
    presentations = normalizeToolItemPresentations(
      this.toolStore,
      {
        maximumCharacters: MAX_PANEL_OUTPUT_CHARS
      }
    ),
    now = this.now()
  ) {
    const presentationById = new Map(
      presentations.map(presentation => [
        presentation.id,
        presentation
      ])
    )
    this.panelModel.reconcileBackground(
      this.backgroundTerminals.map(terminal =>
        backgroundPanel(
          terminal,
          presentationById.get(terminal.itemId)
        )
      ),
      now
    )
  }

  private handleNotification(notification: CodexRpcNotification) {
    const threadId = notificationThreadId(notification)
    if (threadId && threadId !== this.options.identity.threadId) {
      return
    }

    this.transcriptState = reduceRealtimeTranscriptNotification(
      this.transcriptState,
      notification,
      {
        generation: this.generation,
        threadId: this.options.identity.threadId,
        started: this.realtimeStarted
      }
    )
    const nextToolStore = reduceToolItemNotification(
      this.toolStore,
      notification,
      {
        threadId: this.options.identity.threadId
      }
    )
    if (nextToolStore !== this.toolStore) {
      this.toolStore = nextToolStore
      this.syncForegroundPanels()
    }

    switch (notification.method) {
      case 'thread/realtime/started':
        this.realtimeStarted = true
        this.generation += 1
        this.transcriptState = resetRealtimeTranscript(
          this.transcriptState,
          this.generation
        )
        this.activity = 'listening'
        this.error = null
        break
      case 'thread/realtime/transcript/delta': {
        const role = (notification.params as { role?: unknown }).role
        this.activity = role === 'assistant' ? 'speaking' : 'transcribing'
        break
      }
      case 'thread/realtime/transcript/done': {
        const role = (notification.params as { role?: unknown }).role
        this.activity = role === 'assistant' ? 'speaking' : 'listening'
        break
      }
      case 'thread/realtime/error':
        this.activity = 'error'
        this.error = (
          notification.params as { message?: string }
        ).message ?? 'Realtime voice reported an error.'
        break
      case 'thread/realtime/closed':
        this.realtimeStarted = false
        this.activity = 'idle'
        break
      case 'turn/started':
        if (!this.realtimeStarted) {
          this.activity = 'working'
        }
        void this.refreshBackgroundTerminals()
        break
      case 'turn/completed':
        if (!this.realtimeStarted) {
          this.activity = 'idle'
        }
        void this.refreshBackgroundTerminals()
        break
      case 'item/started':
      case 'item/completed':
        void this.refreshBackgroundTerminals()
        break
    }
    this.emit()
  }

  private async refreshBackgroundTerminals() {
    if (this.suspended || this.backgroundRefresh) {
      return await this.backgroundRefresh
    }
    this.backgroundRefresh = (async () => {
      const authoritative = await listAllThreadBackgroundTerminals(
        this.client,
        this.options.identity.threadId
      )
      const reconciliation = reconcileBackgroundTerminals(
        this.backgroundTerminals,
        authoritative,
        this.now()
      )
      this.backgroundTerminals = reconciliation.terminals
      this.syncBackgroundPanels()
      this.emit()
    })().catch((error) => {
      this.error = `Could not refresh background terminals: ${
        error instanceof Error ? error.message : String(error)
      }`
      this.emit()
    }).finally(() => {
      this.backgroundRefresh = null
    })
    return await this.backgroundRefresh
  }

  private resumeTimers() {
    if (this.suspended) {
      return
    }
    if (!this.backgroundTimer) {
      this.backgroundTimer = this.setInterval(() => {
        void this.refreshBackgroundTerminals()
      }, BACKGROUND_TERMINAL_POLL_MS)
    }
    if (!this.modelTimer) {
      this.modelTimer = this.setInterval(() => {
        this.panelModel.advance(this.now())
        this.emit()
      }, 100)
    }
  }

  private stopTimers() {
    if (this.backgroundTimer) {
      this.clearInterval(this.backgroundTimer)
      this.backgroundTimer = null
    }
    if (this.modelTimer) {
      this.clearInterval(this.modelTimer)
      this.modelTimer = null
    }
  }

  setSuspended(suspended: boolean) {
    this.suspended = suspended
    if (suspended) {
      this.stopTimers()
    } else {
      this.resumeTimers()
      void this.refreshBackgroundTerminals()
    }
  }

  scrollPanel(panelId: string, deltaLines: number) {
    this.panelModel.scroll(panelId, deltaLines)
    this.emit()
  }

  markPanelMoved(panelId: string) {
    this.panelModel.markInteraction(panelId, {
      userMoved: true
    })
    this.emit()
  }

  async dispose() {
    this.stopTimers()
    this.releaseNotification?.()
    this.releaseNotification = null
    this.releaseConnection?.()
    this.releaseConnection = null
    this.client.close()
    this.listeners.clear()
    this.panelModel.clear()
  }
}

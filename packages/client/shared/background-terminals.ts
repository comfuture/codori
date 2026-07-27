import type { ThreadBackgroundTerminal } from './generated/codex-app-server/v2/ThreadBackgroundTerminal'
import type { ThreadBackgroundTerminalsListParams } from './generated/codex-app-server/v2/ThreadBackgroundTerminalsListParams'
import type { ThreadBackgroundTerminalsListResponse } from './generated/codex-app-server/v2/ThreadBackgroundTerminalsListResponse'

export const DEFAULT_BACKGROUND_TERMINAL_PAGE_SIZE = 100
export const DEFAULT_BACKGROUND_TERMINAL_MAX_PAGES = 100

export type BackgroundTerminalRpcClient = {
  request<T>(
    method: 'thread/backgroundTerminals/list',
    params: ThreadBackgroundTerminalsListParams
  ): Promise<T>
}

export type BackgroundTerminalModel = {
  source: 'agent-background'
  itemId: string
  processId: string
  command: string
  cwd: string
  osPid: number | null
  cpuPercent: number | null
  rssKb: string | null
  firstSeenAt: number
  lastSeenAt: number
}

export type BackgroundTerminalReconciliation = {
  terminals: BackgroundTerminalModel[]
  added: BackgroundTerminalModel[]
  removed: BackgroundTerminalModel[]
}

export const backgroundTerminalKey = (
  terminal: Pick<ThreadBackgroundTerminal, 'itemId' | 'processId'>
) => `${terminal.itemId}\u0000${terminal.processId}`

const normalizedTerminal = (
  terminal: ThreadBackgroundTerminal,
  nowMs: number,
  previous?: BackgroundTerminalModel
): BackgroundTerminalModel => ({
  source: 'agent-background',
  itemId: terminal.itemId,
  processId: terminal.processId,
  command: terminal.command,
  cwd: String(terminal.cwd),
  osPid: terminal.osPid,
  cpuPercent: terminal.cpuPercent,
  rssKb: terminal.rssKb === null ? null : String(terminal.rssKb),
  firstSeenAt: previous?.firstSeenAt ?? nowMs,
  lastSeenAt: nowMs
})

export const listAllThreadBackgroundTerminals = async (
  client: BackgroundTerminalRpcClient,
  threadId: string,
  options: {
    pageSize?: number
    maxPages?: number
  } = {}
) => {
  const normalizedThreadId = threadId.trim()
  if (!normalizedThreadId) {
    throw new Error('A thread id is required to list background terminals.')
  }

  const pageSize = Math.max(
    1,
    Math.floor(options.pageSize ?? DEFAULT_BACKGROUND_TERMINAL_PAGE_SIZE)
  )
  const maxPages = Math.max(
    1,
    Math.floor(options.maxPages ?? DEFAULT_BACKGROUND_TERMINAL_MAX_PAGES)
  )
  const terminals = new Map<string, ThreadBackgroundTerminal>()
  const seenCursors = new Set<string>()
  let cursor: string | null = null

  for (let page = 0; page < maxPages; page += 1) {
    const response: ThreadBackgroundTerminalsListResponse = await client.request<ThreadBackgroundTerminalsListResponse>(
      'thread/backgroundTerminals/list',
      {
        threadId: normalizedThreadId,
        limit: pageSize,
        ...(cursor ? { cursor } : {})
      }
    )
    for (const terminal of response.data) {
      if (terminal.itemId.trim() && terminal.processId.trim()) {
        terminals.set(backgroundTerminalKey(terminal), terminal)
      }
    }

    if (!response.nextCursor) {
      return [...terminals.values()]
    }
    if (seenCursors.has(response.nextCursor)) {
      throw new Error('Background terminal pagination returned a repeated cursor.')
    }
    seenCursors.add(response.nextCursor)
    cursor = response.nextCursor
  }

  throw new Error(`Background terminal pagination exceeded ${maxPages} pages.`)
}

export const reconcileBackgroundTerminals = (
  previous: readonly BackgroundTerminalModel[],
  authoritative: readonly ThreadBackgroundTerminal[],
  nowMs: number
): BackgroundTerminalReconciliation => {
  const previousByKey = new Map(
    previous.map(terminal => [backgroundTerminalKey(terminal), terminal])
  )
  const terminals: BackgroundTerminalModel[] = []
  const added: BackgroundTerminalModel[] = []
  const authoritativeKeys = new Set<string>()

  for (const terminal of authoritative) {
    if (!terminal.itemId.trim() || !terminal.processId.trim()) {
      continue
    }
    const key = backgroundTerminalKey(terminal)
    if (authoritativeKeys.has(key)) {
      continue
    }
    authoritativeKeys.add(key)
    const model = normalizedTerminal(terminal, nowMs, previousByKey.get(key))
    terminals.push(model)
    if (!previousByKey.has(key)) {
      added.push(model)
    }
  }

  return {
    terminals,
    added,
    removed: previous.filter(terminal =>
      !authoritativeKeys.has(backgroundTerminalKey(terminal))
    )
  }
}

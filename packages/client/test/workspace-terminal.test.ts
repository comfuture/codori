import { describe, expect, it, vi } from 'vitest'
import type { InitializeResponse } from '../shared/generated/codex-app-server/InitializeResponse'
import type {
  CodexRpcConnectionState,
  CodexRpcNotification
} from '../shared/codex-rpc'
import {
  TERMINAL_OUTPUT_BYTES_CAP,
  TERMINAL_CLEANUP_TIMEOUT_MS,
  TERMINAL_MAX_SESSIONS,
  TERMINAL_WRITE_CHUNK_BYTES,
  WorkspaceTerminalProcess,
  canCreateWorkspaceTerminalSession,
  chunkTerminalBytes,
  decodeTerminalBytes,
  encodeTerminalBinaryInput,
  encodeTerminalBytes,
  requiresTerminalPasteConfirmation,
  resolveTerminalLink,
  resolveWorkspaceTerminalPermission,
  resolveWorkspaceTerminalShell,
  createWorkspaceTerminalProcessId,
  createWorkspaceTerminalEmulatorKey,
  sanitizeWorkspaceTerminalSize,
  type WorkspaceTerminalEvent,
  type WorkspaceTerminalRpcClient,
  type WorkspaceTerminalShell
} from '../shared/workspace-terminal'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

type RpcRequest = {
  method: string
  params: unknown
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const flushPromises = async () => {
  await new Promise(resolve => setTimeout(resolve, 0))
}

class FakeTerminalRpcClient implements WorkspaceTerminalRpcClient {
  readonly requests: RpcRequest[] = []

  readonly execResult = deferred<{ exitCode: number, stdout: string, stderr: string }>()

  readonly pendingWrites: Array<Deferred<Record<string, never>>> = []

  closeCount = 0

  notificationReleaseCount = 0

  connectionReleaseCount = 0

  holdWrites = false

  holdTerminate = false

  sandboxMode: unknown = 'workspace-write'

  defaultPermissions: unknown = null

  configReadError: Error | null = null

  readonly pendingTerminate = deferred<Record<string, never>>()

  private readonly notificationListeners = new Set<(notification: CodexRpcNotification) => void>()

  private readonly connectionListeners = new Set<(state: CodexRpcConnectionState) => void>()

  private connectionState: CodexRpcConnectionState = 'idle'

  constructor(
    private readonly initializeResponse: InitializeResponse = {
      userAgent: 'codex-test',
      codexHome: '/tmp/codex-home',
      platformFamily: 'unix',
      platformOs: 'macos'
    }
  ) {}

  async connect() {
    this.emitConnectionState('connected')
  }

  close() {
    this.closeCount += 1
  }

  getInitializeResponse() {
    return this.initializeResponse
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    this.requests.push({ method, params })

    if (method === 'config/read') {
      if (this.configReadError) {
        return Promise.reject(this.configReadError)
      }
      return Promise.resolve({
        config: {
          sandbox_mode: this.sandboxMode,
          default_permissions: this.defaultPermissions
        },
        origins: {},
        layers: null
      }) as Promise<T>
    }

    if (method === 'command/exec') {
      return this.execResult.promise as Promise<T>
    }

    if (method === 'command/exec/write' && this.holdWrites) {
      const pendingWrite = deferred<Record<string, never>>()
      this.pendingWrites.push(pendingWrite)
      return pendingWrite.promise as Promise<T>
    }

    if (method === 'command/exec/terminate' && this.holdTerminate) {
      return this.pendingTerminate.promise as Promise<T>
    }

    return Promise.resolve({}) as Promise<T>
  }

  subscribe(listener: (notification: CodexRpcNotification) => void) {
    this.notificationListeners.add(listener)
    return () => {
      if (this.notificationListeners.delete(listener)) {
        this.notificationReleaseCount += 1
      }
    }
  }

  subscribeConnectionState(listener: (state: CodexRpcConnectionState) => void) {
    this.connectionListeners.add(listener)
    listener(this.connectionState)
    return () => {
      if (this.connectionListeners.delete(listener)) {
        this.connectionReleaseCount += 1
      }
    }
  }

  emitNotification(notification: CodexRpcNotification) {
    for (const listener of this.notificationListeners) {
      listener(notification)
    }
  }

  emitConnectionState(state: CodexRpcConnectionState) {
    this.connectionState = state
    for (const listener of this.connectionListeners) {
      listener(state)
    }
  }

  resolveExec(exitCode: number) {
    this.execResult.resolve({ exitCode, stdout: '', stderr: '' })
  }

  requestsFor(method: string) {
    return this.requests.filter(request => request.method === method)
  }
}

const createProcess = (client = new FakeTerminalRpcClient()) => {
  const output: Uint8Array[] = []
  const events: WorkspaceTerminalEvent[] = []
  const shells: WorkspaceTerminalShell[] = []
  const process = new WorkspaceTerminalProcess({
    client,
    cwd: '/workspace/codori',
    processId: 'terminal-process-1',
    onOutput: bytes => output.push(bytes),
    onEvent: event => events.push(event),
    onShell: shell => shells.push(shell)
  })

  return { client, events, output, process, shells }
}

const outputNotification = (
  processId: string,
  bytes: Uint8Array,
  capReached = false
) => ({
  method: 'command/exec/outputDelta',
  params: {
    processId,
    stream: 'stdout',
    deltaBase64: encodeTerminalBytes(bytes),
    capReached
  }
}) as CodexRpcNotification

describe('workspace terminal byte helpers', () => {
  it('round-trips UTF-8 bytes and preserves raw binary input', () => {
    const utf8 = new TextEncoder().encode('Codori 한글 🙂')

    expect(decodeTerminalBytes(encodeTerminalBytes(utf8))).toEqual(utf8)
    expect(new TextDecoder().decode(decodeTerminalBytes(encodeTerminalBytes(utf8)))).toBe('Codori 한글 🙂')
    expect(encodeTerminalBinaryInput('\x00\x80\xff\u0101')).toEqual(Uint8Array.of(0, 128, 255, 1))

    const everyByte = Uint8Array.from({ length: 256 }, (_, index) => index)
    expect(decodeTerminalBytes(encodeTerminalBytes(everyByte))).toEqual(everyByte)
  })

  it('chunks bytes without changing their order and rejects invalid chunk sizes', () => {
    const bytes = Uint8Array.from({ length: 10 }, (_, index) => index)

    expect(chunkTerminalBytes(bytes, 4)).toEqual([
      Uint8Array.of(0, 1, 2, 3),
      Uint8Array.of(4, 5, 6, 7),
      Uint8Array.of(8, 9)
    ])
    expect(chunkTerminalBytes(new Uint8Array(), 4)).toEqual([])
    expect(() => chunkTerminalBytes(bytes, 0)).toThrow('Terminal chunk size must be a positive integer.')
  })

  it('requires confirmation for multiline and large pastes', () => {
    expect(requiresTerminalPasteConfirmation('git status')).toBe(false)
    expect(requiresTerminalPasteConfirmation('git status\nrm -rf build')).toBe(true)
    expect(requiresTerminalPasteConfirmation('x'.repeat(1024))).toBe(false)
    expect(requiresTerminalPasteConfirmation('x'.repeat(1025))).toBe(true)
  })

  it('enforces the session limit and creates unique process ownership ids', () => {
    expect(canCreateWorkspaceTerminalSession(0)).toBe(true)
    expect(canCreateWorkspaceTerminalSession(TERMINAL_MAX_SESSIONS - 1)).toBe(true)
    expect(canCreateWorkspaceTerminalSession(TERMINAL_MAX_SESSIONS)).toBe(false)
    expect(canCreateWorkspaceTerminalSession(-1)).toBe(false)
    expect(createWorkspaceTerminalProcessId('session')).not.toBe(createWorkspaceTerminalProcessId('session'))
  })

  it('normalizes initial PTY geometry and isolates emulator keys by workspace', () => {
    expect(sanitizeWorkspaceTerminalSize({ cols: 120.9, rows: 40.7 })).toEqual({ cols: 120, rows: 40 })
    expect(sanitizeWorkspaceTerminalSize({ cols: 0, rows: -2 })).toEqual({ cols: 80, rows: 24 })
    expect(sanitizeWorkspaceTerminalSize({ cols: Number.NaN, rows: Number.POSITIVE_INFINITY })).toEqual({ cols: 80, rows: 24 })

    const projectKey = createWorkspaceTerminalEmulatorKey({
      workspace: { kind: 'project', id: 'codori' },
      cwd: '/project/codori',
      sessionId: 'terminal-1',
      generation: 0
    })
    expect(createWorkspaceTerminalEmulatorKey({
      workspace: { kind: 'chat', id: 'codori' },
      cwd: '/project/codori',
      sessionId: 'terminal-1',
      generation: 0
    })).not.toBe(projectKey)
    expect(createWorkspaceTerminalEmulatorKey({
      workspace: { kind: 'project', id: 'codori' },
      cwd: '/project/other',
      sessionId: 'terminal-1',
      generation: 0
    })).not.toBe(projectKey)
  })
})

describe('workspace terminal link and shell policies', () => {
  it('opens only modifier-clicked HTTP(S) links', () => {
    expect(resolveTerminalLink({ ctrlKey: false, metaKey: false }, 'https://example.com')).toBeNull()
    expect(resolveTerminalLink({ ctrlKey: true, metaKey: false }, 'https://example.com/docs')).toBe('https://example.com/docs')
    expect(resolveTerminalLink({ ctrlKey: false, metaKey: true }, 'http://example.com')).toBe('http://example.com/')
    expect(resolveTerminalLink({ ctrlKey: true, metaKey: false }, 'javascript:alert(1)')).toBeNull()
    expect(resolveTerminalLink({ ctrlKey: true, metaKey: false }, 'file:///tmp/secret')).toBeNull()
    expect(resolveTerminalLink({ ctrlKey: true, metaKey: false }, 'not a url')).toBeNull()
  })

  it('maps app-server platforms to argv-based interactive shells', () => {
    const workspacePermission = resolveWorkspaceTerminalPermission({ sandbox_mode: 'workspace-write' })
    const unrestrictedPermission = resolveWorkspaceTerminalPermission({ sandbox_mode: 'danger-full-access' })

    expect(resolveWorkspaceTerminalShell(
      { platformFamily: 'unix', platformOs: 'macos' },
      workspacePermission
    )).toEqual({
      label: 'zsh',
      command: ['/bin/zsh', '-f'],
      permissionProfile: ':workspace',
      permissionLabel: 'Workspace sandbox',
      hasUnrestrictedFilesystemWrite: false
    })
    expect(resolveWorkspaceTerminalShell(
      { platformFamily: 'unix', platformOs: 'macos' },
      unrestrictedPermission
    )).toEqual({
      label: 'zsh',
      command: ['/bin/zsh', '-l'],
      permissionProfile: ':danger-full-access',
      permissionLabel: 'Danger full access',
      hasUnrestrictedFilesystemWrite: true
    })
    expect(resolveWorkspaceTerminalShell(
      { platformFamily: 'unix', platformOs: 'linux' },
      workspacePermission
    )).toEqual({
      label: 'sh',
      command: ['/bin/sh'],
      permissionProfile: ':workspace',
      permissionLabel: 'Workspace sandbox',
      hasUnrestrictedFilesystemWrite: false
    })
    expect(resolveWorkspaceTerminalShell(
      { platformFamily: 'windows', platformOs: 'windows' },
      workspacePermission
    )).toEqual({
      label: 'PowerShell',
      command: ['powershell.exe', '-NoLogo', '-NoProfile'],
      permissionProfile: ':workspace',
      permissionLabel: 'Workspace sandbox',
      hasUnrestrictedFilesystemWrite: false
    })
    expect(() => resolveWorkspaceTerminalShell(
      { platformFamily: 'unknown', platformOs: 'plan9' },
      workspacePermission
    ))
      .toThrow('No supported interactive shell is configured for plan9.')
  })

  it('uses the effective default permission before the legacy sandbox mode', () => {
    expect(resolveWorkspaceTerminalPermission({
      sandbox_mode: 'danger-full-access',
      default_permissions: ':workspace'
    })).toEqual({
      permissionProfile: ':workspace',
      permissionLabel: 'Workspace sandbox',
      hasUnrestrictedFilesystemWrite: false
    })
    expect(resolveWorkspaceTerminalPermission({
      sandbox_mode: 'workspace-write',
      default_permissions: ':danger-full-access'
    })).toEqual({
      permissionProfile: ':danger-full-access',
      permissionLabel: 'Danger full access',
      hasUnrestrictedFilesystemWrite: true
    })
  })
})

describe('WorkspaceTerminalProcess', () => {
  it('starts a no-rc PTY when Codex is limited to the workspace', async () => {
    const { client, events, process, shells } = createProcess()

    await process.start({ cols: 96, rows: 32 })

    expect(client.requestsFor('config/read')).toEqual([{
      method: 'config/read',
      params: { includeLayers: false, cwd: '/workspace/codori' }
    }])
    expect(shells).toEqual([{
      label: 'zsh',
      command: ['/bin/zsh', '-f'],
      permissionProfile: ':workspace',
      permissionLabel: 'Workspace sandbox',
      hasUnrestrictedFilesystemWrite: false
    }])
    expect(events).toEqual([{ state: 'starting' }, { state: 'running' }])
    expect(client.requestsFor('command/exec')).toEqual([{
      method: 'command/exec',
      params: {
        command: ['/bin/zsh', '-f'],
        processId: 'terminal-process-1',
        tty: true,
        cwd: '/workspace/codori',
        size: { cols: 96, rows: 32 },
        env: { TERM: 'xterm-256color' },
        permissionProfile: ':workspace',
        disableTimeout: true,
        outputBytesCap: TERMINAL_OUTPUT_BYTES_CAP
      }
    }])
  })

  it('starts a full login shell when Codex has unrestricted filesystem access', async () => {
    const { client, events, process, shells } = createProcess()
    client.sandboxMode = 'danger-full-access'

    await process.start({ cols: 96, rows: 32 })

    expect(shells).toEqual([{
      label: 'zsh',
      command: ['/bin/zsh', '-l'],
      permissionProfile: ':danger-full-access',
      permissionLabel: 'Danger full access',
      hasUnrestrictedFilesystemWrite: true
    }])
    expect(events).toEqual([{ state: 'starting' }, { state: 'running' }])
    expect(client.requestsFor('command/exec')[0]?.params).toMatchObject({
      command: ['/bin/zsh', '-l'],
      permissionProfile: ':danger-full-access'
    })
  })

  it('falls back to configured permissions and a no-rc shell when permission lookup fails', async () => {
    const { client, events, process, shells } = createProcess()
    client.configReadError = new Error('config unavailable')

    await process.start({ cols: 80, rows: 24 })

    expect(shells).toEqual([{
      label: 'zsh',
      command: ['/bin/zsh', '-f'],
      permissionProfile: null,
      permissionLabel: 'Configured permissions',
      hasUnrestrictedFilesystemWrite: false
    }])
    expect(events).toEqual([{ state: 'starting' }, { state: 'running' }])
    expect(client.requestsFor('command/exec')[0]?.params).not.toHaveProperty('permissionProfile')
  })

  it('falls back to safe initial dimensions before starting a PTY', async () => {
    const { client, process } = createProcess()

    await process.start({ cols: 0, rows: Number.NaN })

    expect(client.requestsFor('command/exec')[0]?.params).toMatchObject({
      size: { cols: 80, rows: 24 }
    })
  })

  it('routes byte output by process id without decoding split UTF-8 chunks', async () => {
    const { client, output, process } = createProcess()
    await process.start({ cols: 80, rows: 24 })

    client.emitNotification(outputNotification('another-process', Uint8Array.of(1, 2, 3)))
    client.emitNotification(outputNotification('terminal-process-1', Uint8Array.of(0xe2, 0x82)))
    client.emitNotification(outputNotification('terminal-process-1', Uint8Array.of(0xac)))

    expect(output).toEqual([
      Uint8Array.of(0xe2, 0x82),
      Uint8Array.of(0xac)
    ])
  })

  it('serializes chunked UTF-8 and binary input writes', async () => {
    const { client, process } = createProcess()
    client.holdWrites = true
    await process.start({ cols: 80, rows: 24 })

    const text = 'a'.repeat(TERMINAL_WRITE_CHUNK_BYTES + 3)
    process.writeText(text)
    process.writeBinary('\x80')
    await flushPromises()

    expect(client.requestsFor('command/exec/write')).toHaveLength(1)
    expect(decodeTerminalBytes((client.requestsFor('command/exec/write')[0]?.params as { deltaBase64: string }).deltaBase64))
      .toEqual(new TextEncoder().encode('a'.repeat(TERMINAL_WRITE_CHUNK_BYTES)))

    client.pendingWrites[0]?.resolve({})
    await flushPromises()
    expect(client.requestsFor('command/exec/write')).toHaveLength(2)
    expect(decodeTerminalBytes((client.requestsFor('command/exec/write')[1]?.params as { deltaBase64: string }).deltaBase64))
      .toEqual(new TextEncoder().encode('aaa'))

    client.pendingWrites[1]?.resolve({})
    await flushPromises()
    expect(client.requestsFor('command/exec/write')).toHaveLength(3)
    expect(decodeTerminalBytes((client.requestsFor('command/exec/write')[2]?.params as { deltaBase64: string }).deltaBase64))
      .toEqual(Uint8Array.of(0x80))
  })

  it('deduplicates the initial and repeated PTY size and ignores invalid geometry', async () => {
    const { client, process } = createProcess()
    await process.start({ cols: 80, rows: 24 })

    process.resize({ cols: 80, rows: 24 })
    process.resize({ cols: 0, rows: 24 })
    process.resize({ cols: 100, rows: 30 })
    process.resize({ cols: 100, rows: 30 })

    expect(client.requestsFor('command/exec/resize')).toEqual([{
      method: 'command/exec/resize',
      params: {
        processId: 'terminal-process-1',
        size: { cols: 100, rows: 30 }
      }
    }])
  })

  it('reports the final command exit code after streamed output completes', async () => {
    const { client, events, process } = createProcess()
    await process.start({ cols: 80, rows: 24 })

    client.resolveExec(7)
    await flushPromises()

    expect(events.at(-1)).toEqual({ state: 'exited', exitCode: 7 })
    expect(client.closeCount).toBe(1)
  })

  it('renders the capped final chunk, marks the limit, and terminates once', async () => {
    const { client, events, output, process } = createProcess()
    await process.start({ cols: 80, rows: 24 })

    client.emitNotification(outputNotification('terminal-process-1', Uint8Array.of(9, 8, 7), true))
    client.emitNotification(outputNotification('terminal-process-1', Uint8Array.of(6), true))
    await flushPromises()

    expect(output).toEqual([Uint8Array.of(9, 8, 7)])
    expect(events.filter(event => event.state === 'output-limit')).toHaveLength(1)
    expect(client.requestsFor('command/exec/terminate')).toEqual([{
      method: 'command/exec/terminate',
      params: { processId: 'terminal-process-1' }
    }])

    client.resolveExec(0)
    await flushPromises()
    expect(events.some(event => event.state === 'exited')).toBe(false)
    expect(client.closeCount).toBe(1)

    await process.dispose()
    expect(client.requestsFor('command/exec/terminate')).toHaveLength(1)
    expect(client.closeCount).toBe(1)
  })

  it('marks a lost connection as disconnected and never presents reconnection as resume', async () => {
    const { client, events, process } = createProcess()
    await process.start({ cols: 80, rows: 24 })

    client.emitConnectionState('disconnected')
    client.emitConnectionState('connected')
    process.writeText('echo should-not-run\n')
    client.resolveExec(0)
    await flushPromises()

    expect(events.filter(event => event.state === 'disconnected')).toHaveLength(1)
    expect(events.at(-1)).toEqual({ state: 'disconnected' })
    expect(client.requestsFor('command/exec/write')).toHaveLength(0)
    expect(client.closeCount).toBe(1)
  })

  it('performs best-effort process and connection cleanup exactly once', async () => {
    const { client, process } = createProcess()
    await process.start({ cols: 80, rows: 24 })

    await process.dispose()
    await process.dispose()

    expect(client.requestsFor('command/exec/terminate')).toEqual([{
      method: 'command/exec/terminate',
      params: { processId: 'terminal-process-1' }
    }])
    expect(client.notificationReleaseCount).toBe(1)
    expect(client.connectionReleaseCount).toBe(1)
    expect(client.closeCount).toBe(1)
  })

  it('bounds cleanup when the terminate request never settles', async () => {
    vi.useFakeTimers()
    try {
      const { client, process } = createProcess()
      client.holdTerminate = true
      await process.start({ cols: 80, rows: 24 })

      const disposePromise = process.dispose()
      await vi.advanceTimersByTimeAsync(TERMINAL_CLEANUP_TIMEOUT_MS)
      await disposePromise

      expect(client.requestsFor('command/exec/terminate')).toHaveLength(1)
      expect(client.closeCount).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

import { spawn } from 'node:child_process'
import os from 'node:os'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import WebSocket from 'ws'
import type {
  CodexDaemonTarget,
  RuntimeBackendFallbackReason
} from './types.js'

const require = createRequire(import.meta.url)
const DEFAULT_PROBE_TIMEOUT_MS = 2_000
const DEFAULT_START_TIMEOUT_MS = 12_000
const MAX_COMMAND_OUTPUT_BYTES = 256 * 1024

type DaemonProbeSuccess = {
  ready: true
  appServerVersion: string | null
}

type DaemonProbeFailure = {
  ready: false
  reason: Extract<
    RuntimeBackendFallbackReason,
    'daemon-unavailable' | 'permission-denied' | 'daemon-unready' | 'incompatible-realtime'
  >
}

export type DaemonProbeResult = DaemonProbeSuccess | DaemonProbeFailure

export type DaemonSelectionResult =
  | {
      selected: true
      target: CodexDaemonTarget
      reusedExisting: boolean
    }
  | {
      selected: false
      reason: RuntimeBackendFallbackReason
    }

export type DaemonStartRequest = {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
}

type ParsedDaemonStart = {
  socketPath: string
  cliVersion: string | null
  appServerVersion: string | null
}

type AppServerBackendSelectorOptions = {
  homeDir?: string
  platform?: NodeJS.Platform
  codexBin?: string
  realtimeVoiceEnabled?: boolean
  probeTimeoutMs?: number
  startTimeoutMs?: number
  probe?: (
    socketPath: string,
    input: { timeoutMs: number, realtimeVoiceEnabled: boolean }
  ) => Promise<DaemonProbeResult>
  startDaemon?: (request: DaemonStartRequest) => Promise<string>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const optionalString = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const nestedRecord = (value: Record<string, unknown>, key: string) => {
  const nested = value[key]
  return isRecord(nested) ? nested : null
}

const parseJsonOutput = (output: string) => {
  const trimmed = output.trim()
  if (!trimmed) {
    throw new Error('The daemon command returned no JSON.')
  }

  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const lines = trimmed.split(/\r?\n/).filter(Boolean)
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      try {
        return JSON.parse(lines[index]!) as unknown
      } catch {
        // Continue searching for the final machine-readable line.
      }
    }
  }

  throw new Error('The daemon command returned invalid JSON.')
}

export const parseDaemonStartOutput = (output: string): ParsedDaemonStart => {
  const parsed = parseJsonOutput(output)
  if (!isRecord(parsed)) {
    throw new Error('The daemon command returned a non-object JSON value.')
  }

  const daemon = nestedRecord(parsed, 'daemon')
  const appServer = nestedRecord(parsed, 'appServer')
    ?? nestedRecord(parsed, 'app_server')
  const socketPath = optionalString(parsed.socketPath)
    ?? optionalString(parsed.socket_path)
    ?? optionalString(parsed.controlSocketPath)
    ?? optionalString(daemon?.socketPath)
    ?? optionalString(daemon?.socket_path)
    ?? optionalString(appServer?.socketPath)
    ?? optionalString(appServer?.socket_path)
  if (!socketPath) {
    throw new Error('The daemon command did not report a control socket.')
  }

  return {
    socketPath,
    cliVersion: optionalString(parsed.cliVersion)
      ?? optionalString(parsed.cli_version)
      ?? optionalString(daemon?.cliVersion)
      ?? optionalString(daemon?.cli_version),
    appServerVersion: optionalString(parsed.appServerVersion)
      ?? optionalString(parsed.app_server_version)
      ?? optionalString(daemon?.appServerVersion)
      ?? optionalString(daemon?.app_server_version)
      ?? optionalString(appServer?.version)
  }
}

const versionFromUserAgent = (value: unknown) => {
  const userAgent = optionalString(value)
  if (!userAgent) {
    return null
  }
  return userAgent.match(/\b\d+\.\d+\.\d+(?:[-+][\w.-]+)?\b/)?.[0] ?? null
}

export const daemonWebSocketUrl = (socketPath: string) =>
  `ws+unix://${socketPath}:/rpc`

export const probeDaemonSocket = async (
  socketPath: string,
  input: { timeoutMs?: number, realtimeVoiceEnabled?: boolean } = {}
): Promise<DaemonProbeResult> => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const realtimeVoiceEnabled = input.realtimeVoiceEnabled ?? false

  return await new Promise<DaemonProbeResult>((resolve) => {
    let settled = false
    let appServerVersion: string | null = null
    const socket = new WebSocket(daemonWebSocketUrl(socketPath), {
      perMessageDeflate: false,
      handshakeTimeout: timeoutMs
    })
    const timer = setTimeout(() => {
      finish({
        ready: false,
        reason: 'daemon-unready'
      })
    }, timeoutMs)

    const finish = (result: DaemonProbeResult) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      socket.removeAllListeners()
      socket.on('error', () => {})
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
      resolve(result)
    }

    socket.once('open', () => {
      socket.send(JSON.stringify({
        id: 'codori-probe-initialize',
        method: 'initialize',
        params: {
          clientInfo: {
            name: 'codori',
            version: '0.0.0'
          },
          capabilities: null
        }
      }))
    })

    socket.on('message', (raw) => {
      let message: Record<string, unknown>
      try {
        const parsed = JSON.parse(raw.toString()) as unknown
        if (!isRecord(parsed)) {
          return
        }
        message = parsed
      } catch {
        return
      }

      if (message.id === 'codori-probe-initialize') {
        if (message.error) {
          finish({ ready: false, reason: 'daemon-unready' })
          return
        }
        const result = isRecord(message.result) ? message.result : null
        appServerVersion = versionFromUserAgent(result?.userAgent)
        socket.send(JSON.stringify({ method: 'initialized' }))
        if (!realtimeVoiceEnabled) {
          finish({ ready: true, appServerVersion })
          return
        }
        socket.send(JSON.stringify({
          id: 'codori-probe-features',
          method: 'experimentalFeature/list',
          params: {}
        }))
        return
      }

      if (message.id === 'codori-probe-features') {
        if (message.error) {
          finish({ ready: false, reason: 'incompatible-realtime' })
          return
        }
        const result = isRecord(message.result) ? message.result : null
        const data = Array.isArray(result?.data) ? result.data : []
        const realtimeFeature = data.find((feature) =>
          isRecord(feature) && feature.name === 'realtime_conversation'
        )
        if (!isRecord(realtimeFeature) || realtimeFeature.enabled !== true) {
          finish({ ready: false, reason: 'incompatible-realtime' })
          return
        }
        socket.send(JSON.stringify({
          id: 'codori-probe-realtime-voices',
          method: 'thread/realtime/listVoices',
          params: {}
        }))
        return
      }

      if (message.id === 'codori-probe-realtime-voices') {
        finish(message.error
          ? { ready: false, reason: 'incompatible-realtime' }
          : { ready: true, appServerVersion })
      }
    })

    socket.once('error', (error) => {
      const code = (error as NodeJS.ErrnoException).code
      finish({
        ready: false,
        reason: code === 'EACCES' || code === 'EPERM'
          ? 'permission-denied'
          : code === 'ENOENT' || code === 'ECONNREFUSED' || code === 'EINVAL'
            ? 'daemon-unavailable'
            : 'daemon-unready'
      })
    })
    socket.once('close', () => {
      if (!settled) {
        finish({ ready: false, reason: 'daemon-unready' })
      }
    })
  })
}

const runDaemonStart = async (request: DaemonStartRequest) =>
  await new Promise<string>((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let outputBytes = 0
    let settled = false

    const finish = (error?: Error) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
        return
      }
      resolve(Buffer.concat(stdout).toString('utf8'))
    }

    const append = (target: Buffer[], chunk: Buffer) => {
      outputBytes += chunk.byteLength
      if (outputBytes > MAX_COMMAND_OUTPUT_BYTES) {
        child.kill('SIGTERM')
        finish(new Error('The daemon command produced too much output.'))
        return
      }
      target.push(chunk)
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new Error('Timed out while ensuring the Codex daemon.'))
    }, request.timeoutMs)
    child.stdout.on('data', (chunk: Buffer) => append(stdout, chunk))
    child.stderr.on('data', (chunk: Buffer) => append(stderr, chunk))
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim()
        finish(new Error(detail || `The daemon command exited with code ${code}.`))
        return
      }
      finish()
    })
  })

export const resolveEffectiveCodexHome = (
  homeDir = os.homedir(),
  env: NodeJS.ProcessEnv = process.env
) => optionalString(env.CODEX_HOME) ?? join(homeDir, '.codex')

export const resolveDaemonStartCommand = (
  realtimeVoiceEnabled: boolean,
  codexBin = process.env.CODORI_CODEX_BIN
) => {
  const args = ['remote-control', 'start', '--json']
  if (realtimeVoiceEnabled) {
    args.push('--enable', 'realtime_conversation')
  }
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

export class AppServerBackendSelector {
  private readonly homeDir: string

  private readonly platform: NodeJS.Platform

  private readonly codexBin: string | undefined

  private readonly realtimeVoiceEnabled: boolean

  private readonly probeTimeoutMs: number

  private readonly startTimeoutMs: number

  private readonly probe: NonNullable<AppServerBackendSelectorOptions['probe']>

  private readonly startDaemon: NonNullable<AppServerBackendSelectorOptions['startDaemon']>

  private ensurePromise: Promise<DaemonSelectionResult> | null = null

  constructor(options: AppServerBackendSelectorOptions = {}) {
    this.homeDir = options.homeDir ?? os.homedir()
    this.platform = options.platform ?? process.platform
    this.codexBin = options.codexBin ?? process.env.CODORI_CODEX_BIN
    this.realtimeVoiceEnabled = options.realtimeVoiceEnabled ?? false
    this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
    this.startTimeoutMs = options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
    this.probe = options.probe ?? (async (socketPath, input) =>
      await probeDaemonSocket(socketPath, input))
    this.startDaemon = options.startDaemon ?? runDaemonStart
  }

  async ensure(): Promise<DaemonSelectionResult> {
    if (this.ensurePromise) {
      return await this.ensurePromise
    }

    this.ensurePromise = this.ensureNow()
    try {
      return await this.ensurePromise
    } finally {
      this.ensurePromise = null
    }
  }

  private async ensureNow(): Promise<DaemonSelectionResult> {
    if (this.platform === 'win32') {
      return {
        selected: false,
        reason: 'unsupported-platform'
      }
    }

    const codexHome = resolveEffectiveCodexHome(this.homeDir)
    const defaultSocketPath = join(
      codexHome,
      'app-server-control',
      'app-server-control.sock'
    )
    const initialProbe = await this.probe(defaultSocketPath, {
      timeoutMs: this.probeTimeoutMs,
      realtimeVoiceEnabled: this.realtimeVoiceEnabled
    })
    if (initialProbe.ready) {
      return {
        selected: true,
        reusedExisting: true,
        target: {
          kind: 'codex-daemon',
          transport: 'unix-socket',
          socketPath: defaultSocketPath,
          ownedByCodori: false,
          cliVersion: null,
          appServerVersion: initialProbe.appServerVersion
        }
      }
    }
    if (initialProbe.reason === 'permission-denied'
      || initialProbe.reason === 'incompatible-realtime') {
      return {
        selected: false,
        reason: initialProbe.reason
      }
    }

    let started: ParsedDaemonStart
    try {
      const command = resolveDaemonStartCommand(
        this.realtimeVoiceEnabled,
        this.codexBin
      )
      const output = await this.startDaemon({
        ...command,
        cwd: this.homeDir,
        env: {
          ...process.env,
          CODEX_HOME: codexHome
        },
        timeoutMs: this.startTimeoutMs
      })
      started = parseDaemonStartOutput(output)
    } catch (error) {
      return {
        selected: false,
        reason: error instanceof SyntaxError
          ? 'invalid-daemon-response'
          : /json|socket/i.test(error instanceof Error ? error.message : String(error))
            ? 'invalid-daemon-response'
            : 'daemon-start-failed'
      }
    }

    const startedProbe = await this.probe(started.socketPath, {
      timeoutMs: this.probeTimeoutMs,
      realtimeVoiceEnabled: this.realtimeVoiceEnabled
    })
    if (!startedProbe.ready) {
      return {
        selected: false,
        reason: startedProbe.reason
      }
    }

    return {
      selected: true,
      reusedExisting: false,
      target: {
        kind: 'codex-daemon',
        transport: 'unix-socket',
        socketPath: started.socketPath,
        ownedByCodori: false,
        cliVersion: started.cliVersion,
        appServerVersion: startedProbe.appServerVersion ?? started.appServerVersion
      }
    }
  }
}

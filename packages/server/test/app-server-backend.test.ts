import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AppServerBackendSelector,
  parseDaemonStartOutput,
  probeDaemonSocket,
  resolveDaemonStartCommand,
  resolveEffectiveCodexHome,
  type DaemonProbeResult,
  type DaemonStartRequest
} from '../src/app-server-backend.js'

describe('app-server backend selection', () => {
  it('resolves CODEX_HOME without exposing a TCP endpoint', () => {
    expect(resolveEffectiveCodexHome('/Users/test', {
      CODEX_HOME: '/srv/codex-home'
    })).toBe('/srv/codex-home')
    expect(resolveEffectiveCodexHome('/Users/test', {}))
      .toBe('/Users/test/.codex')
  })

  it('probes the daemon over its raw Unix JSONL protocol', async () => {
    const root = await mkdtemp('/tmp/codori-daemon-probe-')
    const socketPath = join(root, 'control.sock')
    const methods: string[] = []
    let initializeCapabilities: unknown
    const server = createServer((socket) => {
      let buffer = ''
      socket.on('data', (chunk) => {
        buffer += chunk.toString()
        let newlineIndex = buffer.indexOf('\n')
        while (newlineIndex >= 0) {
          const line = buffer.slice(0, newlineIndex)
          buffer = buffer.slice(newlineIndex + 1)
          const message = JSON.parse(line) as {
            id?: string
            method: string
            params?: {
              capabilities?: unknown
            }
          }
          methods.push(message.method)
          if (message.method === 'initialize') {
            initializeCapabilities = message.params?.capabilities
            const response = `${JSON.stringify({
              method: 'server/ready',
              params: {}
            })}\n${JSON.stringify({
              id: message.id,
              result: {
                userAgent: 'codex-app-server/0.145.0'
              }
            })}\n`
            socket.write(response.slice(0, 17))
            socket.write(response.slice(17))
          } else if (message.method === 'experimentalFeature/list') {
            socket.write(`${JSON.stringify({
              id: message.id,
              result: {
                data: [{
                  name: 'realtime_conversation',
                  enabled: true
                }]
              }
            })}\n`)
          } else if (message.method === 'thread/realtime/listVoices') {
            socket.write(`${JSON.stringify({
              id: message.id,
              result: {
                voices: {
                  voices: []
                }
              }
            })}\n`)
          }
          newlineIndex = buffer.indexOf('\n')
        }
      })
    })
    await new Promise<void>((resolvePromise, reject) => {
      server.listen(socketPath, (error?: Error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise()
      })
    })

    try {
      await expect(probeDaemonSocket(socketPath, {
        realtimeVoiceEnabled: true
      })).resolves.toEqual({
        ready: true,
        appServerVersion: '0.145.0'
      })
      expect(methods).toEqual([
        'initialize',
        'initialized',
        'experimentalFeature/list',
        'thread/realtime/listVoices'
      ])
      expect(initializeCapabilities).toEqual({
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: null
      })
    } finally {
      await new Promise<void>(resolvePromise => server.close(() => resolvePromise()))
      await rm(root, { recursive: true, force: true })
    }
  })

  it('parses current and nested daemon start output shapes', () => {
    expect(parseDaemonStartOutput(JSON.stringify({
      socketPath: '/tmp/current.sock',
      cliVersion: '0.145.0',
      appServerVersion: '0.144.5'
    }))).toEqual({
      socketPath: '/tmp/current.sock',
      cliVersion: '0.145.0',
      appServerVersion: '0.144.5'
    })
    expect(parseDaemonStartOutput(`diagnostic\n${JSON.stringify({
      daemon: {
        socket_path: '/tmp/nested.sock',
        cli_version: '0.146.0'
      },
      appServer: {
        version: '0.146.1'
      }
    })}`)).toEqual({
      socketPath: '/tmp/nested.sock',
      cliVersion: '0.146.0',
      appServerVersion: '0.146.1'
    })
  })

  it('reuses a ready default daemon without invoking the start command', async () => {
    const probe = vi.fn(async (): Promise<DaemonProbeResult> => ({
      ready: true,
      appServerVersion: '0.145.0'
    }))
    const startDaemon = vi.fn()
    const selector = new AppServerBackendSelector({
      homeDir: '/Users/test',
      platform: 'darwin',
      probe,
      startDaemon
    })

    await expect(selector.ensure()).resolves.toEqual({
      selected: true,
      reusedExisting: true,
      target: {
        kind: 'codex-daemon',
        transport: 'unix-socket',
        socketPath: join(
          '/Users/test/.codex',
          'app-server-control',
          'app-server-control.sock'
        ),
        ownedByCodori: false,
        cliVersion: null,
        appServerVersion: '0.145.0'
      }
    })
    expect(startDaemon).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent daemon starts and probes the returned socket', async () => {
    const firstProbe = {
      ready: false,
      reason: 'daemon-unavailable'
    } satisfies DaemonProbeResult
    const readyProbe = {
      ready: true,
      appServerVersion: '0.145.1'
    } satisfies DaemonProbeResult
    const probe = vi.fn()
      .mockResolvedValueOnce(firstProbe)
      .mockResolvedValueOnce(readyProbe)
    let releaseStart!: () => void
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve
    })
    const startDaemon = vi.fn(async (request: DaemonStartRequest) => {
      void request
      await startGate
      return JSON.stringify({
        socketPath: '/tmp/started.sock',
        cliVersion: '0.145.0',
        appServerVersion: '0.145.0'
      })
    })
    const selector = new AppServerBackendSelector({
      homeDir: '/Users/test',
      platform: 'linux',
      realtimeVoiceEnabled: true,
      probe,
      startDaemon
    })

    const project = selector.ensure()
    const chat = selector.ensure()
    releaseStart()

    const [projectResult, chatResult] = await Promise.all([project, chat])
    expect(projectResult).toEqual(chatResult)
    expect(projectResult).toMatchObject({
      selected: true,
      reusedExisting: false,
      target: {
        socketPath: '/tmp/started.sock',
        cliVersion: '0.145.0',
        appServerVersion: '0.145.1'
      }
    })
    expect(startDaemon).toHaveBeenCalledOnce()
    expect(startDaemon.mock.calls[0]![0].args.slice(-5)).toEqual([
      'remote-control',
      'start',
      '--json',
      '--enable',
      'realtime_conversation'
    ])
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it('falls back without restarting an existing realtime-incompatible daemon', async () => {
    const startDaemon = vi.fn()
    const selector = new AppServerBackendSelector({
      homeDir: '/Users/test',
      platform: 'darwin',
      realtimeVoiceEnabled: true,
      probe: async () => ({
        ready: false,
        reason: 'incompatible-realtime'
      }),
      startDaemon
    })

    await expect(selector.ensure()).resolves.toEqual({
      selected: false,
      reason: 'incompatible-realtime'
    })
    expect(startDaemon).not.toHaveBeenCalled()
  })

  it('reports unsupported and failed daemon paths as controlled fallback reasons', async () => {
    const unsupported = new AppServerBackendSelector({
      platform: 'win32'
    })
    await expect(unsupported.ensure()).resolves.toEqual({
      selected: false,
      reason: 'unsupported-platform'
    })

    const failed = new AppServerBackendSelector({
      homeDir: '/Users/test',
      platform: 'darwin',
      probe: async () => ({
        ready: false,
        reason: 'daemon-unavailable'
      }),
      startDaemon: async () => {
        throw new Error('command unavailable')
      }
    })
    await expect(failed.ensure()).resolves.toEqual({
      selected: false,
      reason: 'daemon-start-failed'
    })
  })

  it('builds direct and bundled daemon commands with realtime feature parity', () => {
    expect(resolveDaemonStartCommand(true, '/usr/local/bin/codex')).toEqual({
      command: '/usr/local/bin/codex',
      args: [
        'remote-control',
        'start',
        '--json',
        '--enable',
        'realtime_conversation'
      ]
    })
    expect(resolveDaemonStartCommand(false, '/usr/local/bin/codex')).toEqual({
      command: '/usr/local/bin/codex',
      args: ['remote-control', 'start', '--json']
    })
  })
})

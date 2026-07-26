import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  AppServerBackendSelector,
  daemonWebSocketUrl,
  parseDaemonStartOutput,
  resolveDaemonStartCommand,
  resolveEffectiveCodexHome,
  type DaemonProbeResult,
  type DaemonStartRequest
} from '../src/app-server-backend.js'

describe('app-server backend selection', () => {
  it('resolves CODEX_HOME and the Unix WebSocket URL without exposing a TCP port', () => {
    expect(resolveEffectiveCodexHome('/Users/test', {
      CODEX_HOME: '/srv/codex-home'
    })).toBe('/srv/codex-home')
    expect(resolveEffectiveCodexHome('/Users/test', {}))
      .toBe('/Users/test/.codex')
    expect(daemonWebSocketUrl('/srv/codex-home/control.sock'))
      .toBe('ws+unix:///srv/codex-home/control.sock:/rpc')
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

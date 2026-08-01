import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  CLI_USAGE,
  isCliEntrypointPath,
  resolveServeRoot,
  resolveServiceCliAction,
  runCli
} from '../src/cli.js'

const createOutput = () => {
  const stream = new PassThrough()
  let output = ''
  stream.on('data', (chunk) => {
    output += chunk.toString()
  })

  return {
    stream,
    read: () => output
  }
}

describe('cli service commands', () => {
  it('prints canonical package invocation in the help text', async () => {
    const stdout = createOutput()

    await runCli(['--help'], {
      stdout: stdout.stream
    })

    expect(stdout.read()).toContain('npx @codori/server service install')
    expect(stdout.read()).toContain('codori service install')
    // The legacy aliases stay discoverable so existing docs keep working.
    expect(stdout.read()).toContain('install-service')
    expect(CLI_USAGE).toContain('npx @codori/server <command>')
    expect(CLI_USAGE).toContain('--experimental-realtime-voice')
    expect(CLI_USAGE).toContain('--tailscale-serve')
  })

  it('rejects the runtime-only realtime flag for installed service commands', async () => {
    await expect(runCli([
      'install-service',
      '--experimental-realtime-voice',
      '--yes'
    ])).rejects.toThrow(/realtimeVoice\.enabled in ~\/\.codori\/config\.json/)
  })

  it('maps service subcommands and legacy aliases to one action set', () => {
    expect(resolveServiceCliAction('service', 'install')).toBe('install')
    expect(resolveServiceCliAction('service', 'setup')).toBe('install')
    expect(resolveServiceCliAction('service', 'start')).toBe('start')
    expect(resolveServiceCliAction('service', 'stop')).toBe('stop')
    expect(resolveServiceCliAction('service', 'restart')).toBe('restart')
    expect(resolveServiceCliAction('service', 'status')).toBe('status')
    expect(resolveServiceCliAction('service', 'uninstall')).toBe('uninstall')

    expect(resolveServiceCliAction('install-service', undefined)).toBe('install')
    expect(resolveServiceCliAction('setup-service', undefined)).toBe('install')
    expect(resolveServiceCliAction('restart-service', undefined)).toBe('restart')
    expect(resolveServiceCliAction('uninstall-service', undefined)).toBe('uninstall')

    // Project-scoped runtime verbs must not be captured as service actions.
    expect(resolveServiceCliAction('start', 'my-project')).toBeNull()
    expect(resolveServiceCliAction('stop', 'my-project')).toBeNull()
    expect(resolveServiceCliAction('serve', undefined)).toBeNull()
  })

  it('rejects a bare or unknown service subcommand', () => {
    expect(() => resolveServiceCliAction('service', undefined))
      .toThrow(/requires one of install, start, stop, restart, status, or uninstall/)
    expect(() => resolveServiceCliAction('service', 'reload'))
      .toThrow(/Unknown service subcommand "reload"/)
  })

  it('adopts the remembered root only for a managed service launch', () => {
    const lastRoot = () => '/remembered/root'

    expect(resolveServeRoot(undefined, {
      env: { CODORI_SERVICE_MANAGED: '1' },
      cwd: '/cwd',
      lastRoot
    })).toBe('/remembered/root')

    expect(resolveServeRoot(undefined, {
      env: {},
      cwd: '/cwd',
      lastRoot
    })).toBe('/cwd')

    expect(resolveServeRoot('/explicit', {
      env: { CODORI_SERVICE_MANAGED: '1' },
      cwd: '/cwd',
      lastRoot
    })).toBe('/explicit')

    expect(resolveServeRoot(undefined, {
      env: { CODORI_SERVICE_MANAGED: '1' },
      cwd: '/cwd',
      lastRoot: () => null
    })).toBe('/cwd')
  })

  it('prefers the remembered root over the install-time root', () => {
    // A root changed from Settings must survive an OS restart instead of
    // reverting to the directory chosen at install time.
    expect(resolveServeRoot(undefined, {
      env: {
        CODORI_SERVICE_MANAGED: '1',
        CODORI_SERVICE_INSTALL_ROOT: '/install/root'
      },
      cwd: '/cwd',
      lastRoot: () => '/remembered/root'
    })).toBe('/remembered/root')

    // With nothing remembered yet, the install-time root is the fallback.
    expect(resolveServeRoot(undefined, {
      env: {
        CODORI_SERVICE_MANAGED: '1',
        CODORI_SERVICE_INSTALL_ROOT: '/install/root'
      },
      cwd: '/cwd',
      lastRoot: () => null
    })).toBe('/install/root')
  })

  it('rejects tailscale serve for installed service commands', async () => {
    await expect(runCli([
      'install-service',
      '--tailscale-serve',
      '--yes'
    ])).rejects.toThrow(/available only for a direct `serve` launch/)
  })

  it('treats setup-service as an alias for install-service', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })
    const stdout = createOutput()

    await runCli(['setup-service', '--root', root, '--yes'], {
      homeDir,
      cwd: root,
      platform: 'darwin',
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      stdout: stdout.stream,
      runCommand: async (command) => ({
        exitCode: command === 'tailscale' ? 1 : 0,
        stdout: '',
        stderr: ''
      })
    })

    expect(stdout.read()).toContain('Installed service io.codori.server.')
    expect(stdout.read()).toContain('Warning: Binding Codori to 0.0.0.0 can expose it without authentication.')
  })

  it('prints usage for unknown commands instead of requiring a root', async () => {
    const stdout = createOutput()

    await runCli(['bogus-command'], {
      stdout: stdout.stream
    })

    expect(stdout.read()).toContain('Usage:')
    expect(stdout.read()).toContain('restart-service')
  })

  it('treats symlinked bin paths as the cli entrypoint', () => {
    const tempDir = mkdtempSync(join(os.tmpdir(), 'codori-cli-'))
    const realPath = join(tempDir, 'cli.js')
    const symlinkPath = join(tempDir, 'codori')
    writeFileSync(realPath, '#!/usr/bin/env node\n', 'utf8')
    symlinkSync(realPath, symlinkPath)

    expect(isCliEntrypointPath(symlinkPath, new URL(`file://${realPath}`).href)).toBe(true)
  })

  it('rejects a non-loopback host with tailscale serve', async () => {
    await expect(runCli([
      '--root',
      '/tmp/projects',
      '--host',
      '0.0.0.0',
      '--tailscale-serve'
    ])).rejects.toThrow(/requires --host 127\.0\.0\.1/)
  })

  it('configures tailscale serve after starting a loopback server', async () => {
    const stdout = createOutput()
    const app = {
      close: vi.fn(),
      ready: vi.fn()
    }
    const manager = {
      config: {
        root: '/tmp/projects',
        server: {
          host: '127.0.0.1',
          port: 4310
        },
        realtimeVoice: {
          enabled: true
        }
      }
    }
    const createRuntimeManager = vi.fn(() => manager)
    const configureTailscaleServe = vi.fn().mockResolvedValue({
      url: 'https://codori-host.example.ts.net/',
      alreadyConfigured: false
    })

    await runCli([
      '--root',
      '/tmp/projects',
      '--tailscale-serve'
    ], {
      stdout: stdout.stream,
      createRuntimeManager: createRuntimeManager as never,
      startHttpServer: vi.fn(async () => app) as never,
      configureTailscaleServe
    })

    expect(createRuntimeManager).toHaveBeenCalledWith({
      configOverrides: {
        root: '/tmp/projects',
        host: '127.0.0.1',
        port: undefined,
        realtimeVoiceEnabled: undefined
      }
    })
    expect(configureTailscaleServe).toHaveBeenCalledWith(4310, undefined)
    expect(app.close).not.toHaveBeenCalled()
    expect(app.ready).toHaveBeenCalled()
    expect(stdout.read()).toContain('Codori listening on http://127.0.0.1:4310')
    expect(stdout.read()).toContain(
      'Tailscale Serve configured: https://codori-host.example.ts.net/'
    )
  })

  it('closes the server when tailscale serve setup fails', async () => {
    const app = {
      close: vi.fn(),
      ready: vi.fn()
    }
    const manager = {
      config: {
        root: '/tmp/projects',
        server: {
          host: '127.0.0.1',
          port: 4310
        }
      }
    }

    await expect(runCli([
      '--root',
      '/tmp/projects',
      '--tailscale-serve'
    ], {
      createRuntimeManager: vi.fn(() => manager) as never,
      startHttpServer: vi.fn(async () => app) as never,
      configureTailscaleServe: vi.fn().mockRejectedValue(new Error('serve failed'))
    })).rejects.toThrow('serve failed')

    expect(app.close).toHaveBeenCalled()
    expect(app.ready).not.toHaveBeenCalled()
  })
})

import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  CLI_USAGE,
  isCliEntrypointPath,
  resolveServeRoot,
  resolveServiceCliAction,
  runCli
} from '../src/cli.js'
import { CodoriError } from '../src/errors.js'

/**
 * A server launch records the served root in `~/.codori/last-root.json`, and
 * these tests launch with fixture roots. Without an isolated home, the suite
 * overwrote the developer's real remembered root with a fixture path such as
 * `/tmp/projects`, which then made a running service serve a directory that
 * does not exist.
 */
const originalHome = process.env.HOME
const originalUserProfile = process.env.USERPROFILE
let scratchHome: string

beforeAll(() => {
  scratchHome = mkdtempSync(join(os.tmpdir(), 'codori-cli-home-'))
  process.env.HOME = scratchHome
  process.env.USERPROFILE = scratchHome
})

afterAll(() => {
  if (originalHome === undefined) {
    delete process.env.HOME
  } else {
    process.env.HOME = originalHome
  }
  if (originalUserProfile === undefined) {
    delete process.env.USERPROFILE
  } else {
    process.env.USERPROFILE = originalUserProfile
  }
})

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
  it('leads the help text with the installed binary and global install', async () => {
    const stdout = createOutput()

    await runCli(['--help'], {
      stdout: stdout.stream
    })

    const help = stdout.read()
    // The installed binary is the documented primary entrypoint.
    expect(help).toContain('npm install -g @codori/cli')
    expect(help).toContain('codori <command> [options]')
    expect(help).toContain('codori service install')
    expect(help).toContain('start')
    expect(help).toContain('Deprecated aliases serve')
    // Running without installing stays documented as the alternative.
    expect(help).toContain('npx @codori/server <command> [options]')
    // Each command carries a description rather than a bare name.
    expect(help).toContain('Start the Codori server, dashboard, WebXR app, and API.')
    // Workspace lifecycle belongs to the dashboard, not the CLI.
    expect(help).toContain('managed from the dashboard')
    expect(help).not.toContain('Stop the workspace runtime for one project.')
    expect(help).not.toContain('status [projectId]')
    // The legacy aliases stay discoverable so existing docs keep working.
    expect(help).toContain('install-service')
    expect(CLI_USAGE).toContain('--experimental-realtime-voice')
    expect(CLI_USAGE).toContain('--tailscale-serve')
  })

  it('renders help without ANSI escapes for a non-tty stream', async () => {
    const stdout = createOutput()

    await runCli(['--help'], {
      stdout: stdout.stream
    })

    // eslint-disable-next-line no-control-regex
    expect(stdout.read()).not.toMatch(/\u001B\[/)
  })

  it('shows help for a bare invocation instead of starting a server', async () => {
    const stdout = createOutput()
    const startHttpServer = vi.fn()

    await runCli([], {
      stdout: stdout.stream,
      startHttpServer: startHttpServer as never
    })

    expect(stdout.read()).toContain('Usage')
    expect(stdout.read()).toContain('npm install -g @codori/cli')
    // A first-time user must not accidentally bind a server.
    expect(startHttpServer).not.toHaveBeenCalled()
  })

  it('still defaults to serve when only flags are passed', async () => {
    const stdout = createOutput()
    const app = { close: vi.fn(), ready: vi.fn() }
    const startHttpServer = vi.fn(async () => app)
    const manager = {
      config: {
        root: '/tmp/projects',
        server: { host: '127.0.0.1', port: 4310 }
      }
    }

    // The documented `npx @codori/server --root ~/Project` form has no command.
    await runCli(['--root', '/tmp/projects'], {
      stdout: stdout.stream,
      createRuntimeManager: vi.fn(() => manager) as never,
      startHttpServer: startHttpServer as never,
      detectTailscaleServeEligibility: vi.fn(async () => ({
        eligible: false,
        dnsName: null,
        reason: 'unavailable' as const
      })),
      checkStartupUpdate: vi.fn(async () => ({ checked: false, adopted: false })) as never
    })

    expect(startHttpServer).toHaveBeenCalled()
    expect(stdout.read()).toContain('Codori listening on http://127.0.0.1:4310')
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

  it('never adopts a remembered root for a managed service launch', () => {
    const lastRoot = () => '/remembered/root'

    expect(resolveServeRoot(undefined, {
      env: { CODORI_SERVICE_MANAGED: '1' },
      cwd: '/cwd',
      lastRoot
    })).toBe('/cwd')

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

  it('uses the process cwd instead of legacy service-root state', () => {
    expect(resolveServeRoot(undefined, {
      env: {
        CODORI_SERVICE_MANAGED: '1',
        CODORI_SERVICE_INSTALL_ROOT: '/install/root'
      },
      cwd: '/cwd',
      lastRoot: () => '/remembered/root'
    })).toBe('/cwd')

    // Install-time roots are legacy metadata, not server project selection.
    expect(resolveServeRoot(undefined, {
      env: {
        CODORI_SERVICE_MANAGED: '1',
        CODORI_SERVICE_INSTALL_ROOT: '/install/root'
      },
      cwd: '/cwd',
      lastRoot: () => null
    })).toBe('/cwd')
  })

  it('persists and configures required tailscale serve for service installs', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })
    const stdout = createOutput()
    const configureTailscaleServe = vi.fn(async () => ({
      url: 'https://codori-host.example.ts.net/',
      alreadyConfigured: false
    }))

    await runCli([
      'service',
      'install',
      '--root',
      root,
      '--tailscale-serve',
      '--yes'
    ], {
      homeDir,
      cwd: root,
      platform: 'darwin',
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      stdout: stdout.stream,
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      configureTailscaleServe
    })

    expect(configureTailscaleServe).toHaveBeenCalledWith(4310, expect.any(Function))
    expect(stdout.read()).toContain('Tailscale Serve configured: https://codori-host.example.ts.net/')
  })

  it('automatically configures tailscale serve for service installs', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })
    const stdout = createOutput()
    const configureTailscaleServe = vi.fn(async () => ({
      url: 'https://codori-host.example.ts.net/',
      alreadyConfigured: true
    }))

    await runCli(['service', 'install', '--root', root, '--yes'], {
      homeDir,
      cwd: root,
      platform: 'darwin',
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      stdout: stdout.stream,
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      detectTailscaleServeEligibility: vi.fn(async () => ({
        eligible: true,
        dnsName: 'codori-host.example.ts.net',
        reason: 'available' as const
      })),
      configureTailscaleServe
    })

    expect(configureTailscaleServe).toHaveBeenCalledWith(4310, expect.any(Function))
    expect(stdout.read()).toContain('Tailscale Serve  auto')
    expect(stdout.read()).toContain('Tailscale Serve reusing: https://codori-host.example.ts.net/')
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
    expect(stdout.read()).toContain('host             127.0.0.1')
    expect(stdout.read()).toContain('Tailscale Serve  auto')
  })

  it('prints usage for unknown commands instead of requiring a root', async () => {
    const stdout = createOutput()

    await runCli(['bogus-command'], {
      stdout: stdout.stream
    })

    expect(stdout.read()).toContain('Usage')
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

  it('rejects contradictory tailscale serve options', async () => {
    await expect(runCli([
      'start',
      '--root',
      '/tmp/projects',
      '--tailscale-serve',
      '--no-tailscale-serve'
    ])).rejects.toThrow(/cannot be used together/)
  })

  // `list`, `status`, and `stop` read and mutated local runtime state instead of
  // the running server. They now point at the dashboard, which already performs
  // the same operations over the HTTP API.
  it.each([
    ['list', 'Projects are listed in the dashboard sidebar.'],
    ['status', 'Workspace runtime status is shown in the dashboard sidebar.'],
    ['stop', 'Stop a workspace from the dashboard.']
  ])('rejects the retired %s command with a specific reason', async (command, reason) => {
    const createRuntimeManager = vi.fn()

    await expect(runCli([command, '--root', '/tmp/projects'], {
      stdout: createOutput().stream,
      createRuntimeManager: createRuntimeManager as never
    })).rejects.toThrow(reason)

    // A rejected command must not build a second runtime manager in the CLI.
    expect(createRuntimeManager).not.toHaveBeenCalled()
  })

  it('still shows help for an unknown command', async () => {
    const stdout = createOutput()

    await runCli(['bogus-runtime-command'], {
      stdout: stdout.stream
    })

    expect(stdout.read()).toContain('codori <command> [options]')
  })

  // `--json` only applied to the retired commands, but rejecting it at the
  // parser hid the migration message from exactly the scripted callers who
  // needed it: `codori list --json` produced a generic unknown-option error.
  it('reaches migration guidance for a retired command invoked with --json', async () => {
    await expect(runCli(['list', '--json'], {
      stdout: createOutput().stream
    })).rejects.toThrow(/Projects are listed in the dashboard sidebar/)
  })

  it('rejects --json by name on a surviving command', async () => {
    const startHttpServer = vi.fn()

    await expect(runCli(['start', '--root', '/tmp/projects', '--json'], {
      stdout: createOutput().stream,
      startHttpServer: startHttpServer as never
    })).rejects.toThrow(/--json was removed with the project runtime commands/)

    expect(startHttpServer).not.toHaveBeenCalled()
  })

  it('rejects --json on a service command instead of ignoring it', async () => {
    await expect(runCli(['service', 'status', '--json'], {
      stdout: createOutput().stream
    })).rejects.toThrow(/--json was removed with the project runtime commands/)
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

  it('automatically configures tailscale serve for bare start on an eligible host', async () => {
    const stdout = createOutput()
    const app = { close: vi.fn(), ready: vi.fn() }
    const manager = {
      config: {
        root: '/tmp/projects',
        server: { host: '127.0.0.1', port: 4310 }
      }
    }
    const createRuntimeManager = vi.fn(() => manager)
    const configureTailscaleServe = vi.fn(async () => ({
      url: 'https://codori-host.example.ts.net/',
      alreadyConfigured: true
    }))

    await runCli(['start', '--root', '/tmp/projects'], {
      stdout: stdout.stream,
      createRuntimeManager: createRuntimeManager as never,
      startHttpServer: vi.fn(async () => app) as never,
      detectTailscaleServeEligibility: vi.fn(async () => ({
        eligible: true,
        dnsName: 'codori-host.example.ts.net',
        reason: 'available' as const
      })),
      configureTailscaleServe,
      checkStartupUpdate: vi.fn(async () => ({ checked: false, adopted: false })) as never
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
    expect(stdout.read()).toContain('Tailscale Serve reusing: https://codori-host.example.ts.net/')
  })

  it('keeps an automatic start running when Serve setup is unavailable', async () => {
    const stdout = createOutput()
    const app = { close: vi.fn(), ready: vi.fn() }
    const manager = {
      config: {
        root: '/tmp/projects',
        server: { host: '127.0.0.1', port: 4310 }
      }
    }

    await runCli(['start', '--root', '/tmp/projects'], {
      stdout: stdout.stream,
      createRuntimeManager: vi.fn(() => manager) as never,
      startHttpServer: vi.fn(async () => app) as never,
      detectTailscaleServeEligibility: vi.fn(async () => ({
        eligible: true,
        dnsName: 'codori-host.example.ts.net',
        reason: 'available' as const
      })),
      configureTailscaleServe: vi.fn().mockRejectedValue(new Error('HTTPS is disabled')),
      checkStartupUpdate: vi.fn(async () => ({ checked: false, adopted: false })) as never
    })

    expect(app.close).not.toHaveBeenCalled()
    expect(app.ready).toHaveBeenCalled()
    expect(stdout.read()).toContain('Tailscale Serve was not configured automatically: HTTPS is disabled')
  })

  // A denied Serve write carries recovery steps in the error detail. Warning
  // with the summary alone told the user it was refused and nothing else.
  it('prints the recovery steps when Serve is denied for this user', async () => {
    const stdout = createOutput()
    const app = { close: vi.fn(), ready: vi.fn() }
    const manager = {
      config: {
        root: '/tmp/projects',
        server: { host: '127.0.0.1', port: 4310 }
      }
    }

    await runCli(['start', '--root', '/tmp/projects'], {
      stdout: stdout.stream,
      createRuntimeManager: vi.fn(() => manager) as never,
      startHttpServer: vi.fn(async () => app) as never,
      detectTailscaleServeEligibility: vi.fn(async () => ({
        eligible: true,
        dnsName: 'codori-host.example.ts.net',
        reason: 'available' as const
      })),
      configureTailscaleServe: vi.fn().mockRejectedValue(new CodoriError(
        'TAILSCALE_SERVE_DENIED',
        'Tailscale denied the Serve configuration for this user.',
        'Grant this user ongoing control: sudo tailscale set --operator=ubuntu\nOr configure it once: sudo tailscale serve --bg --yes --https=443 http://127.0.0.1:4310'
      )),
      checkStartupUpdate: vi.fn(async () => ({ checked: false, adopted: false })) as never
    })

    const output = stdout.read()
    expect(output).toContain('Tailscale denied the Serve configuration for this user.')
    expect(output).toContain('sudo tailscale set --operator=ubuntu')
    expect(output).toContain('sudo tailscale serve --bg --yes --https=443')
    // The server still serves on loopback, so a denial must not stop the launch.
    expect(app.close).not.toHaveBeenCalled()
    expect(app.ready).toHaveBeenCalled()
  })

  it('skips tailscale detection and mutation when explicitly disabled', async () => {
    const app = { close: vi.fn(), ready: vi.fn() }
    const manager = {
      config: {
        root: '/tmp/projects',
        server: { host: '127.0.0.1', port: 4310 }
      }
    }
    const detectTailscaleServeEligibility = vi.fn()
    const configureTailscaleServe = vi.fn()

    await runCli([
      'start',
      '--root',
      '/tmp/projects',
      '--no-tailscale-serve'
    ], {
      stdout: createOutput().stream,
      createRuntimeManager: vi.fn(() => manager) as never,
      startHttpServer: vi.fn(async () => app) as never,
      detectTailscaleServeEligibility,
      configureTailscaleServe,
      checkStartupUpdate: vi.fn(async () => ({ checked: false, adopted: false })) as never
    })

    expect(detectTailscaleServeEligibility).not.toHaveBeenCalled()
    expect(configureTailscaleServe).not.toHaveBeenCalled()
    expect(app.ready).toHaveBeenCalled()
  })

  it('rejects start with a project id instead of silently serving the root', async () => {
    const startHttpServer = vi.fn()
    const manager = {
      config: { root: '/tmp/projects' },
      startProject: vi.fn()
    }

    await expect(runCli(['start', 'codori', '--root', '/tmp/projects'], {
      stdout: createOutput().stream,
      createRuntimeManager: vi.fn(() => manager) as never,
      startHttpServer: startHttpServer as never
    })).rejects.toThrow(/`codori start <projectId>` was removed/)

    // Neither the old direct spawn nor an accidental full server launch runs.
    expect(manager.startProject).not.toHaveBeenCalled()
    expect(startHttpServer).not.toHaveBeenCalled()
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

  it('omits the tailscale advisory for a loopback serve launch', async () => {
    const stdout = createOutput()
    const app = { close: vi.fn(), ready: vi.fn() }
    const manager = {
      config: {
        root: '/tmp/projects',
        server: { host: '127.0.0.1', port: 4310 }
      }
    }

    await runCli(['serve', '--root', '/tmp/projects'], {
      stdout: stdout.stream,
      createRuntimeManager: vi.fn(() => manager) as never,
      startHttpServer: vi.fn(async () => app) as never,
      detectTailscaleServeEligibility: vi.fn(async () => ({
        eligible: false,
        dnsName: null,
        reason: 'unavailable' as const
      })),
      checkStartupUpdate: vi.fn(async () => ({ checked: false, adopted: false })) as never
    })

    const output = stdout.read()
    expect(output).toContain('Codori listening on http://127.0.0.1:4310')
    expect(output).toContain('`codori serve` is deprecated')
    expect(output).toContain('root')
    // A loopback launch cannot benefit from the hint, so it must stay quiet.
    expect(output).not.toContain('--tailscale-serve to configure')
    expect(output).not.toContain('Private HTTPS is not enabled')
  })

  it('keeps the https hint for a non-loopback serve launch', async () => {
    const stdout = createOutput()
    const app = { close: vi.fn(), ready: vi.fn() }
    const manager = {
      config: {
        root: '/tmp/projects',
        server: { host: '0.0.0.0', port: 4310 }
      }
    }

    await runCli(['serve', '--root', '/tmp/projects', '--host', '0.0.0.0'], {
      stdout: stdout.stream,
      createRuntimeManager: vi.fn(() => manager) as never,
      startHttpServer: vi.fn(async () => app) as never,
      checkStartupUpdate: vi.fn(async () => ({ checked: false, adopted: false })) as never
    })

    // A remote-reachable bind is the case where HTTPS actually matters.
    expect(stdout.read()).toContain('--tailscale-serve for private HTTPS')
  })
})

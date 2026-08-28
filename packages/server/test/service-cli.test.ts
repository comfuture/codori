import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CodoriError } from '../src/errors.js'
import {
  installService,
  getServiceMetadataPath,
  listInstalledServices,
  resolveInstalledServiceRoot,
  restartService,
  startService,
  statusService,
  stopService,
  uninstallService
} from '../src/service.js'

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

describe('service lifecycle orchestration', () => {
  it('installs, restarts, and uninstalls a macOS user service', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    const commands: string[] = []
    const userId = typeof process.getuid === 'function' ? process.getuid() : 0
    const stdout = createOutput()
    const runCommand = async (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(' ')}`)
      if (command === 'tailscale') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            BackendState: 'Running',
            Self: {
              TailscaleIPs: ['100.88.1.2']
            }
          }),
          stderr: ''
        }
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: ''
      }
    }

    const installed = await installService({
      root,
      yes: true
    }, {
      homeDir,
      cwd: root,
      platform: 'darwin',
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      runCommand,
      stdout: stdout.stream
    })

    expect(installed.metadata.host).toBe('127.0.0.1')
    expect(installed.metadata.tailscaleServePolicy).toBe('auto')
    expect(installed.metadata.port).toBe(4310)
    expect(existsSync(installed.metadata.launcherPath)).toBe(true)
    expect(existsSync(installed.metadata.serviceFilePath)).toBe(true)
    expect(readFileSync(installed.metadata.launcherPath, 'utf8')).toContain(
      "exec '/opt/node/bin/npx' --yes @codori/server start"
    )
    expect(stdout.read()).toContain('Service installation summary:')
    expect(commands).toContain(
      `launchctl bootstrap gui/${userId} ${installed.metadata.serviceFilePath}`
    )

    const restarted = await restartService({
      root,
      yes: true
    }, {
      homeDir,
      cwd: root,
      platform: 'darwin',
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      runCommand,
      stdout: stdout.stream
    })

    expect(restarted.metadata.installedAt).toBe(installed.metadata.installedAt)
    expect(commands).toContain(
      `launchctl kickstart -k gui/${userId}/${installed.metadata.serviceName}`
    )

    const removed = await uninstallService({
      root,
      yes: true
    }, {
      homeDir,
      cwd: root,
      platform: 'darwin',
      runCommand,
      stdout: stdout.stream
    })

    expect(removed.metadata.serviceName).toBe(installed.metadata.serviceName)
    expect(existsSync(installed.metadata.serviceFilePath)).toBe(false)
    expect(existsSync(join(homeDir, '.codori', 'services', installed.metadata.installId))).toBe(false)
    expect(commands).toContain(
      `launchctl disable gui/${userId}/${installed.metadata.serviceName}`
    )
  })

  it('installs, starts, stops, and uninstalls a Windows user service', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    const commands: string[] = []
    const stdout = createOutput()
    let taskExists = false
    const runCommand = async (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(' ')}`)

      if (command === 'tailscale') {
        return {
          exitCode: 1,
          stdout: '',
          stderr: ''
        }
      }

      if (command === 'schtasks') {
        // schtasks exits nonzero for a missing task, and /End is nonzero when idle.
        if (args[0] === '/Create') {
          taskExists = true
        } else if (args[0] === '/Delete') {
          if (!taskExists) {
            return {
              exitCode: 1,
              stdout: '',
              stderr: 'ERROR: The system cannot find the file specified.'
            }
          }
          taskExists = false
        } else if (args[0] === '/End') {
          return {
            exitCode: 1,
            stdout: '',
            stderr: 'ERROR: The system cannot find the file specified.'
          }
        }
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: ''
      }
    }

    const dependencies = {
      homeDir,
      cwd: root,
      platform: 'win32' as NodeJS.Platform,
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      npxPath: 'C:\\Program Files\\nodejs\\npx.cmd',
      runCommand,
      stdout: stdout.stream
    }

    const installed = await installService({
      root,
      host: '127.0.0.1',
      tailscaleServePolicy: 'disabled',
      yes: true
    }, dependencies)

    expect(installed.metadata.platform).toBe('win32')
    expect(installed.metadata.launcherPath.endsWith('run-service.cmd')).toBe(true)
    expect(existsSync(installed.metadata.launcherPath)).toBe(true)
    expect(existsSync(installed.metadata.serviceFilePath)).toBe(true)

    const launcher = readFileSync(installed.metadata.launcherPath, 'utf8')
    expect(launcher).toContain('@echo off')
    expect(launcher).toContain('set "CODORI_SERVICE_MANAGED=1"')
    expect(launcher).toContain(`set "CODORI_SERVICE_INSTALL_ID=${installed.metadata.installId}"`)
    expect(launcher).toContain('set "CODORI_SERVICE_SCOPE=user"')
    expect(launcher).toContain('npx.cmd" --yes @codori/server start')
    expect(launcher).toContain('--no-tailscale-serve')

    // The task definition must be UTF-16 for schtasks /XML to accept it.
    const taskXml = readFileSync(installed.metadata.serviceFilePath, 'utf16le')
    expect(taskXml).toContain('<LogonTrigger>')
    expect(taskXml).toContain(installed.metadata.launcherPath)

    expect(commands).toContain(
      `schtasks /Create /TN ${installed.metadata.serviceName} /XML ${installed.metadata.serviceFilePath} /F`
    )

    const started = await startService({ root, yes: true }, dependencies)
    expect(started.metadata.tailscaleServePolicy).toBe('disabled')
    expect(commands).toContain(`schtasks /Run /TN ${installed.metadata.serviceName}`)

    await stopService({ root, yes: true }, dependencies)
    expect(commands).toContain(`schtasks /End /TN ${installed.metadata.serviceName}`)

    const status = await statusService({ root, yes: true }, dependencies)
    expect(status.action).toBe('status')
    expect(commands).toContain(
      `schtasks /Query /TN ${installed.metadata.serviceName} /V /FO LIST`
    )

    const removed = await uninstallService({ root, yes: true }, dependencies)
    expect(removed.metadata.serviceName).toBe(installed.metadata.serviceName)
    expect(commands).toContain(`schtasks /Delete /TN ${installed.metadata.serviceName} /F`)
    expect(existsSync(join(homeDir, '.codori', 'services', installed.metadata.installId))).toBe(false)
  })

  it('does not create a remembered-root record during lifecycle operations', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const installRoot = mkdtempSync(join(os.tmpdir(), 'codori-root-a-'))
    mkdirSync(join(installRoot, '.git'), { recursive: true })

    const dependencies = {
      homeDir,
      cwd: installRoot,
      platform: 'darwin' as NodeJS.Platform,
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      stdout: createOutput().stream
    }

    await installService({
      root: installRoot,
      host: '127.0.0.1',
      yes: true
    }, dependencies)

    await restartService({ root: installRoot, yes: true }, dependencies)
    await stopService({ root: installRoot, yes: true }, dependencies)
    await startService({ root: installRoot, yes: true }, dependencies)
    expect(existsSync(join(homeDir, '.codori', 'last-root.json'))).toBe(false)
  })

  it('restarts an active linux service when start applies launch overrides', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })
    const commands: string[] = []
    const runCommand = async (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(' ')}`)
      return {
        exitCode: 0,
        stdout: args[0] === '--version' ? 'systemd 255' : '',
        stderr: ''
      }
    }
    const dependencies = {
      homeDir,
      cwd: root,
      platform: 'linux' as NodeJS.Platform,
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      runCommand,
      stdout: createOutput().stream
    }

    const installed = await installService({ root, yes: true }, dependencies)
    commands.length = 0

    const started = await startService({
      root,
      host: '0.0.0.0',
      tailscaleServePolicy: 'disabled',
      yes: true
    }, dependencies)

    expect(started.metadata.host).toBe('0.0.0.0')
    expect(started.metadata.tailscaleServePolicy).toBe('disabled')
    expect(commands).toContain('systemctl --user daemon-reload')
    expect(commands).toContain(`systemctl --user restart ${installed.metadata.serviceName}`)
    expect(commands).not.toContain(`systemctl --user start ${installed.metadata.serviceName}`)
  })

  it('migrates legacy service metadata and launcher on restart', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })
    const dependencies = {
      homeDir,
      cwd: root,
      platform: 'darwin' as NodeJS.Platform,
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      stdout: createOutput().stream
    }

    const installed = await installService({
      root,
      host: '100.88.1.2',
      yes: true
    }, dependencies)
    const legacyMetadata = Object.fromEntries(
      Object.entries(installed.metadata)
        .filter(([key]) => key !== 'tailscaleServePolicy')
    )
    writeFileSync(
      getServiceMetadataPath(installed.metadata.installId, homeDir),
      `${JSON.stringify(legacyMetadata, null, 2)}\n`,
      'utf8'
    )

    const restarted = await restartService({ root, yes: true }, dependencies)

    expect(restarted.metadata.host).toBe('127.0.0.1')
    expect(restarted.metadata.tailscaleServePolicy).toBe('auto')
    expect(readFileSync(restarted.metadata.launcherPath, 'utf8')).toContain(
      "@codori/server start --host '127.0.0.1'"
    )
    expect(JSON.parse(readFileSync(
      getServiceMetadataPath(restarted.metadata.installId, homeDir),
      'utf8'
    ))).toMatchObject({
      host: '127.0.0.1',
      tailscaleServePolicy: 'auto'
    })
  })

  it('prints a runnable canonical command when elevation is missing', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    const dependencies = {
      homeDir,
      cwd: root,
      platform: 'win32' as NodeJS.Platform,
      nodePath: 'C:\\Program Files\\nodejs\\node.exe',
      npxPath: 'C:\\Program Files\\nodejs\\npx.cmd',
      runCommand: async (command: string) => ({
        exitCode: command === 'net' ? 1 : 0,
        stdout: '',
        stderr: ''
      }),
      stdout: createOutput().stream
    }

    // Install the service as an elevated session first so lifecycle commands
    // have metadata to load.
    await installService({
      root,
      host: '127.0.0.1',
      scope: 'system',
      yes: true
    }, {
      ...dependencies,
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' })
    })

    const failures = await Promise.all([
      startService({
        root,
        host: '0.0.0.0',
        tailscaleServePolicy: 'disabled',
        yes: true
      }, dependencies).catch(error => String(error.message)),
      stopService({ root, yes: true }, dependencies).catch(error => String(error.message)),
      statusService({ root, yes: true }, dependencies).catch(error => String(error.message))
    ])

    // `start-service`, `stop-service`, and `status-service` are not accepted by
    // the CLI, so a printed recovery command must use the `service <verb>` form.
    expect(failures[0]).toContain('service start')
    expect(failures[0]).toContain('--host 0.0.0.0')
    expect(failures[0]).toContain('--no-tailscale-serve')
    expect(failures[1]).toContain('service stop')
    expect(failures[2]).toContain('service status')
    for (const message of failures) {
      expect(message).not.toMatch(/(start|stop|status)-service/)
    }
  })

  it('refuses a Windows system-scope install without elevation', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    await expect(installService({
      root,
      host: '127.0.0.1',
      scope: 'system',
      tailscaleServePolicy: 'required',
      yes: true
    }, {
      homeDir,
      cwd: root,
      platform: 'win32',
      runCommand: async (command) => ({
        // `net session` failing is the non-elevated signal.
        exitCode: command === 'net' ? 1 : 0,
        stdout: '',
        stderr: ''
      }),
      stdout: createOutput().stream
    })).rejects.toThrow(/elevated prompt.*--tailscale-serve/)

    // Nothing should be written before the elevation check passes.
    expect(existsSync(join(homeDir, '.codori', 'services'))).toBe(false)
  })

  it('fails on linux when systemd user services are unavailable', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))

    await expect(installService({
      root,
      yes: true
    }, {
      homeDir,
      cwd: root,
      platform: 'linux',
      runCommand: async (command, args) => {
        if (command === 'tailscale') {
          return {
            exitCode: 1,
            stdout: '',
            stderr: ''
          }
        }

        if (args[0] === '--version') {
          return {
            exitCode: 0,
            stdout: 'systemd 255',
            stderr: ''
          }
        }

        return {
          exitCode: 1,
          stdout: '',
          stderr: 'no user bus'
        }
      },
      stdout: createOutput().stream
    })).rejects.toThrow(/systemd user services are unavailable/)
  })

  it('keeps service metadata when uninstall fails after the first command', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    const stdout = createOutput()
    const failingCommand = 'launchctl disable'
    const runCommand = async (command: string, args: string[]) => {
      if (command === 'tailscale') {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            BackendState: 'Running',
            Self: {
              TailscaleIPs: ['100.88.1.2']
            }
          }),
          stderr: ''
        }
      }

      const rendered = `${command} ${args.join(' ')}`
      if (rendered.startsWith(failingCommand)) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'disable failed'
        }
      }

      return {
        exitCode: 0,
        stdout: '',
        stderr: ''
      }
    }

    const installed = await installService({
      root,
      yes: true
    }, {
      homeDir,
      cwd: root,
      platform: 'darwin',
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      runCommand,
      stdout: stdout.stream
    })

    await expect(uninstallService({
      root,
      yes: true
    }, {
      homeDir,
      cwd: root,
      platform: 'darwin',
      runCommand,
      stdout: stdout.stream
    })).rejects.toThrow(/Command failed: launchctl disable/)

    expect(existsSync(join(homeDir, '.codori', 'services', installed.metadata.installId, 'service.json'))).toBe(true)
  })
})

/**
 * These cover the fix for `codori service restart` failing with
 * `EPERM: operation not permitted, scandir '~/.Trash'`. A lifecycle command
 * must resolve its target from recorded install metadata, never by scanning the
 * current directory.
 */
describe('installed service root resolution', () => {
  const createServiceMetadata = (
    homeDir: string,
    installId: string,
    root: string
  ) => {
    const metadataPath = getServiceMetadataPath(installId, homeDir)
    mkdirSync(dirname(metadataPath), { recursive: true })
    writeFileSync(metadataPath, JSON.stringify({
      installId,
      root,
      host: '127.0.0.1',
      port: 4310,
      scope: 'user',
      platform: 'darwin',
      serviceName: `io.codori.server.${installId}`,
      serviceFilePath: join(homeDir, 'Library', 'LaunchAgents', `io.codori.server.${installId}.plist`),
      launcherPath: join(homeDir, '.codori', 'services', installId, 'run-service.sh'),
      installedAt: '2026-08-03T00:00:00.000Z',
      tailscaleServePolicy: 'auto'
    }), 'utf8')
  }

  it('adopts the only registered install instead of inspecting the cwd', () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    createServiceMetadata(homeDir, 'aaaaaaaaaaaa', '/srv/projects')

    expect(resolveInstalledServiceRoot(undefined, homeDir)).toBe('/srv/projects')
  })

  it('prefers an explicit root over the registered install', () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const explicitRoot = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    createServiceMetadata(homeDir, 'aaaaaaaaaaaa', '/srv/projects')

    expect(resolveInstalledServiceRoot(explicitRoot, homeDir)).toBe(explicitRoot)
  })

  it('reports ambiguity instead of guessing between several installs', () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    createServiceMetadata(homeDir, 'aaaaaaaaaaaa', '/srv/alpha')
    createServiceMetadata(homeDir, 'bbbbbbbbbbbb', '/srv/beta')

    expect(() => resolveInstalledServiceRoot(undefined, homeDir)).toThrow(/legacy root-keyed services/)
  })

  it('explains that nothing is installed rather than scanning for a root', () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))

    expect(() => resolveInstalledServiceRoot(undefined, homeDir))
      .toThrow(/No registered Codori service was found/)
  })

  it('skips a malformed metadata file when listing installs', () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    createServiceMetadata(homeDir, 'aaaaaaaaaaaa', '/srv/projects')
    const brokenPath = getServiceMetadataPath('bbbbbbbbbbbb', homeDir)
    mkdirSync(dirname(brokenPath), { recursive: true })
    writeFileSync(brokenPath, '{ not json', 'utf8')

    expect(listInstalledServices(homeDir).map(install => install.root)).toEqual(['/srv/projects'])
    expect(resolveInstalledServiceRoot(undefined, homeDir)).toBe('/srv/projects')
  })

  it('restarts from an unrelated cwd without touching the filesystem outside ~/.codori', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })
    const dependencies = {
      homeDir,
      cwd: root,
      platform: 'darwin' as NodeJS.Platform,
      nodePath: '/opt/node/bin/node',
      npxPath: '/opt/node/bin/npx',
      runCommand: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      stdout: createOutput().stream
    }

    await installService({ root, yes: true }, dependencies)

    // A directory with no .git child and no workspace marker used to send
    // restart through a full recursive scan of that directory.
    const unrelatedCwd = mkdtempSync(join(os.tmpdir(), 'codori-elsewhere-'))
    const restarted = await restartService({}, {
      ...dependencies,
      cwd: unrelatedCwd
    })

    expect(restarted.metadata.root).toBe(root)
  })
})

describe('linux service failures', () => {
  const createLinuxDependencies = (
    homeDir: string,
    root: string,
    runCommand: (command: string, args: string[]) => Promise<{ exitCode: number, stdout: string, stderr: string }>
  ) => ({
    homeDir,
    cwd: root,
    platform: 'linux' as NodeJS.Platform,
    nodePath: '/home/u/.nvm/versions/node/v22.12.0/bin/node',
    npxPath: '/home/u/.nvm/versions/node/v22.12.0/bin/npx',
    runCommand,
    stdout: createOutput().stream
  })

  it('reports systemd output and how to inspect a failed unit', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    // `systemctl --user enable --now` is the step that failed on Ubuntu when the
    // generated unit was unloadable.
    const dependencies = createLinuxDependencies(homeDir, root, async (command, args) => {
      if (command === 'systemctl' && args.includes('enable')) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'Failed to start codori.service: Unit codori.service has a bad unit file setting.'
        }
      }
      return {
        exitCode: 0,
        stdout: args[0] === '--version' ? 'systemd 249' : '',
        stderr: ''
      }
    })

    const failure = await installService({ root, yes: true }, dependencies)
      .catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(CodoriError)
    const error = failure as CodoriError
    expect(error.code).toBe('SERVICE_COMMAND_FAILED')
    // The reason and the follow-up command both have to reach the user; the
    // command line alone left nothing to act on.
    expect(String(error.details)).toContain('bad unit file setting')
    expect(String(error.details)).toContain('systemctl --user status')
    expect(String(error.details)).toContain('journalctl --user -u')
  })

  // `daemon-reload` is a manager-state command with no unit argument. Keying the
  // hint off the last argument pointed users at `status daemon-reload`, which is
  // not a unit.
  it('omits unit diagnostics when a manager-state command fails', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    const dependencies = createLinuxDependencies(homeDir, root, async (command, args) => {
      if (command === 'systemctl' && args.includes('daemon-reload')) {
        return {
          exitCode: 1,
          stdout: '',
          stderr: 'Failed to reload daemon: Connection reset by peer'
        }
      }
      return {
        exitCode: 0,
        stdout: args[0] === '--version' ? 'systemd 249' : '',
        stderr: ''
      }
    })

    const failure = await installService({ root, yes: true }, dependencies)
      .catch((error: unknown) => error) as CodoriError

    expect(failure.code).toBe('SERVICE_COMMAND_FAILED')
    expect(String(failure.details)).toContain('Failed to reload daemon')
    expect(String(failure.details)).not.toContain('status daemon-reload')
    expect(String(failure.details)).not.toContain('-u daemon-reload')
    expect(String(failure.details)).not.toContain('journalctl')
  })

  it('prints an elevation command that survives sudo resetting PATH', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    const dependencies = createLinuxDependencies(homeDir, root, async () => ({
      exitCode: 0,
      stdout: '',
      stderr: ''
    }))

    const message = await installService({
      root,
      scope: 'system',
      yes: true
    }, dependencies).then(() => '', (error: Error) => error.message)

    // A bare `sudo codori` fails when Node is per-user: sudo's secure_path
    // either hides the binary or resolves its shebang to a distro Node too old
    // to parse the bundle.
    expect(message).toContain('sudo --preserve-env=PATH')
    expect(message).toContain('"$(command -v codori)" service install')
    expect(message).toContain('--scope system')
    expect(message).not.toMatch(/Re-run with: sudo codori/)
  })
})

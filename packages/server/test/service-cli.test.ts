import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import {
  installService,
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

    expect(installed.metadata.host).toBe('100.88.1.2')
    expect(installed.metadata.port).toBe(4310)
    expect(existsSync(installed.metadata.launcherPath)).toBe(true)
    expect(existsSync(installed.metadata.serviceFilePath)).toBe(true)
    expect(readFileSync(installed.metadata.launcherPath, 'utf8')).toContain(
      "exec '/opt/node/bin/npx' --yes @codori/server serve"
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
    expect(launcher).toContain('npx.cmd" --yes @codori/server serve')

    // The task definition must be UTF-16 for schtasks /XML to accept it.
    const taskXml = readFileSync(installed.metadata.serviceFilePath, 'utf16le')
    expect(taskXml).toContain('<LogonTrigger>')
    expect(taskXml).toContain(installed.metadata.launcherPath)

    expect(commands).toContain(
      `schtasks /Create /TN ${installed.metadata.serviceName} /XML ${installed.metadata.serviceFilePath} /F`
    )

    await startService({ root, yes: true }, dependencies)
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

  it('refuses a Windows system-scope install without elevation', async () => {
    const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    mkdirSync(join(root, '.git'), { recursive: true })

    await expect(installService({
      root,
      host: '127.0.0.1',
      scope: 'system',
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
    })).rejects.toThrow(/elevated prompt/)

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

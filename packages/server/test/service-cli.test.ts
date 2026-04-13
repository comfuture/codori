import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { installService, restartService, uninstallService } from '../src/service.js'

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

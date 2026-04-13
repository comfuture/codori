import { mkdirSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { CLI_USAGE, runCli } from '../src/cli.js'

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

    expect(stdout.read()).toContain('npx @codori/server install-service')
    expect(stdout.read()).toContain('codori install-service')
    expect(CLI_USAGE).toContain('npx @codori/server <command>')
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
})

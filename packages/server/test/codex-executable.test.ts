import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveDaemonStartCommand } from '../src/app-server-backend.js'
import {
  createCodexExecutableResolver,
  resolveCodexExecutable
} from '../src/codex-executable.js'
import { resolveCodexCommand } from '../src/process-manager.js'

const tempDirectories: string[] = []

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map(path =>
    rm(path, { recursive: true, force: true })
  ))
})

const createBinDirectory = async (executable = true) => {
  const root = await mkdtemp(join(os.tmpdir(), 'codori-codex-bin-'))
  tempDirectories.push(root)
  const bin = join(root, 'bin')
  const candidate = join(bin, 'codex')
  await mkdir(bin)
  await writeFile(candidate, '#!/bin/sh\nexit 0\n')
  await chmod(candidate, executable ? 0o755 : 0o644)
  return { bin, candidate }
}

const waitForCondition = async (condition: () => boolean, timeoutMs = 2_000) => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (condition()) {
      return true
    }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 25))
  }
  return condition()
}

const isPidAlive = (pid: number) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('Codex executable resolution', () => {
  it('preserves an explicit override without probing PATH', async () => {
    const { bin } = await createBinDirectory()
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      override: '/opt/custom/codex-wrapper',
      env: { PATH: bin },
      bundledPath: '/bundle/codex.js',
      execPath: '/usr/bin/node',
      probe
    })

    expect(executable).toEqual({
      path: '/opt/custom/codex-wrapper',
      source: 'override',
      fallbackReason: null,
      command: '/opt/custom/codex-wrapper',
      argsPrefix: []
    })
    expect(probe).not.toHaveBeenCalled()
  })

  it('discovers and validates a codex wrapper on PATH', async () => {
    const { bin, candidate } = await createBinDirectory()
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      env: { PATH: bin },
      bundledPath: '/bundle/codex.js',
      execPath: '/usr/bin/node',
      probe
    })

    expect(executable).toEqual({
      path: candidate,
      source: 'path',
      fallbackReason: null,
      command: candidate,
      argsPrefix: []
    })
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith(candidate, expect.objectContaining({
      env: { PATH: bin },
      timeoutMs: 2_000
    }))
  })

  it('prefers Windows PATHEXT shims over an extensionless POSIX shim', async () => {
    const { bin } = await createBinDirectory()
    const commandShim = join(bin, 'codex.cmd')
    await writeFile(commandShim, '@echo off\r\nexit /b 0\r\n')
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      platform: 'win32',
      env: { PATH: bin, PATHEXT: '.CMD;.EXE' },
      bundledPath: join(bin, 'bundle-codex.js'),
      execPath: 'C:\\node.exe',
      probe
    })

    expect(executable).toMatchObject({
      path: commandShim,
      source: 'path',
      command: commandShim,
      shell: true
    })
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith(commandShim, expect.any(Object))
  })

  it('uses the bundle when PATH has no codex entry', async () => {
    const probe = vi.fn(async () => ({ usable: true as const }))

    await expect(resolveCodexExecutable({
      env: { PATH: '/missing' },
      bundledPath: '/bundle/codex.js',
      execPath: '/usr/bin/node',
      probe
    })).resolves.toEqual({
      path: '/bundle/codex.js',
      source: 'bundle',
      fallbackReason: 'path-not-found',
      command: '/usr/bin/node',
      argsPrefix: ['/bundle/codex.js']
    })
    expect(probe).not.toHaveBeenCalled()
  })

  it('records a validation failure and falls back to the bundle', async () => {
    const { bin, candidate } = await createBinDirectory()
    const probe = vi.fn(async () => ({
      usable: false as const,
      reason: 'path-validation-failed' as const
    }))

    const executable = await resolveCodexExecutable({
      env: { PATH: bin },
      bundledPath: '/bundle/codex.js',
      execPath: '/usr/bin/node',
      probe
    })

    expect(probe).toHaveBeenCalledWith(candidate, expect.any(Object))
    expect(executable).toEqual({
      path: '/bundle/codex.js',
      source: 'bundle',
      fallbackReason: 'path-validation-failed',
      command: '/usr/bin/node',
      argsPrefix: ['/bundle/codex.js']
    })
  })

  it('does not bypass a failed PATH entry with a different later install', async () => {
    const first = await createBinDirectory()
    const second = await createBinDirectory()
    const probe = vi.fn()
      .mockResolvedValueOnce({
        usable: false as const,
        reason: 'path-validation-failed' as const
      })
      .mockResolvedValueOnce({ usable: true as const })

    const executable = await resolveCodexExecutable({
      env: { PATH: `${first.bin}:${second.bin}` },
      bundledPath: '/bundle/codex.js',
      execPath: '/usr/bin/node',
      probe
    })

    expect(executable.source).toBe('bundle')
    expect(executable.fallbackReason).toBe('path-validation-failed')
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith(first.candidate, expect.any(Object))
  })

  it('skips a non-executable codex file without probing it', async () => {
    const { bin } = await createBinDirectory(false)
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      env: { PATH: bin },
      bundledPath: '/bundle/codex.js',
      execPath: '/usr/bin/node',
      probe
    })

    expect(executable.source).toBe('bundle')
    expect(executable.fallbackReason).toBe('path-not-executable')
    expect(probe).not.toHaveBeenCalled()
  })

  if (process.platform !== 'win32') {
    it('terminates and awaits a timed-out validation process group', async () => {
      const { bin, candidate } = await createBinDirectory()
      const childPidFile = join(bin, 'child.pid')
      await writeFile(candidate, [
        '#!/bin/sh',
        '/bin/sleep 30 &',
        `echo $! > "${childPidFile}"`,
        'wait'
      ].join('\n'))

      const executable = await resolveCodexExecutable({
        env: { PATH: bin },
        bundledPath: '/bundle/codex.js',
        execPath: '/usr/bin/node',
        validationTimeoutMs: 2_000
      })
      expect(executable.source).toBe('bundle')
      expect(executable.fallbackReason).toBe('path-validation-timeout')
      const childPid = Number((await readFile(childPidFile, 'utf8')).trim())

      try {
        expect(await waitForCondition(() => !isPidAlive(childPid))).toBe(true)
      } finally {
        if (isPidAlive(childPid)) {
          process.kill(childPid, 'SIGKILL')
        }
      }
    })
  }

  it('caches one resolution for daemon and managed launch commands', async () => {
    const { bin, candidate } = await createBinDirectory()
    const probe = vi.fn(async () => ({ usable: true as const }))
    const resolver = createCodexExecutableResolver({
      env: { PATH: bin },
      bundledPath: '/bundle/codex.js',
      execPath: '/usr/bin/node',
      probe
    })

    const daemonCommand = resolveDaemonStartCommand(true, await resolver())
    const managedCommand = resolveCodexCommand(4765, await resolver(), true)

    expect(daemonCommand.command).toBe(candidate)
    expect(daemonCommand.args).toEqual([
      'remote-control',
      'start',
      '--json',
      '--enable',
      'realtime_conversation'
    ])
    expect(managedCommand.command).toBe(candidate)
    expect(managedCommand.args).toEqual([
      'app-server',
      '--enable',
      'realtime_conversation',
      '--listen',
      'ws://127.0.0.1:4765'
    ])
    expect(probe).toHaveBeenCalledOnce()
  })
})

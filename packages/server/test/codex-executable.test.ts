import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
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

const createBundledBinDirectory = async () => {
  const root = await mkdtemp(join(os.tmpdir(), 'codori-bundled-codex-bin-'))
  tempDirectories.push(root)
  const bin = join(root, 'node_modules', '.bin')
  const bundledPath = join(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  const candidate = join(bin, 'codex')
  const commandShim = join(bin, 'codex.cmd')
  await mkdir(bin, { recursive: true })
  await mkdir(dirname(bundledPath), { recursive: true })
  await writeFile(bundledPath, '#!/usr/bin/env node\n')
  await chmod(bundledPath, 0o755)
  await symlink(bundledPath, candidate)
  await writeFile(commandShim, '@echo off\r\nnode "%~dp0\\..\\@openai\\codex\\bin\\codex.js" %*\r\n')
  return { bin, bundledPath, candidate, commandShim }
}

const createNestedBundledBinDirectory = async () => {
  const root = await mkdtemp(join(os.tmpdir(), 'codori-nested-bundled-bin-'))
  tempDirectories.push(root)
  const outerBin = join(root, 'node_modules', '.bin')
  const nestedNodeModules = join(
    root,
    'node_modules',
    '@codori',
    'server',
    'node_modules'
  )
  const nestedBin = join(nestedNodeModules, '.bin')
  const bundledPath = join(
    nestedNodeModules,
    '@openai',
    'codex',
    'bin',
    'codex.js'
  )
  const bundledCommandShim = join(nestedBin, 'codex.cmd')
  const outerCommandShim = join(outerBin, 'codex.cmd')
  await mkdir(nestedBin, { recursive: true })
  await mkdir(outerBin, { recursive: true })
  await mkdir(dirname(bundledPath), { recursive: true })
  await writeFile(bundledPath, '#!/usr/bin/env node\n')
  await writeFile(bundledCommandShim, '@echo off\r\nexit /b 0\r\n')
  await writeFile(outerCommandShim, '@echo off\r\nexit /b 0\r\n')
  return {
    bundledPath,
    nestedBin,
    outerBin,
    outerCommandShim
  }
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

  it('skips a bundled Windows npm shim before a later installed wrapper', async () => {
    const bundled = await createBundledBinDirectory()
    const installed = await createBinDirectory()
    const installedCommandShim = join(installed.bin, 'codex.cmd')
    await writeFile(installedCommandShim, '@echo off\r\nexit /b 0\r\n')
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      platform: 'win32',
      env: {
        PATH: `${bundled.bin};${installed.bin}`,
        PATHEXT: '.CMD'
      },
      bundledPath: bundled.bundledPath,
      execPath: 'C:\\node.exe',
      probe
    })

    expect(executable).toMatchObject({
      path: installedCommandShim,
      source: 'path',
      fallbackReason: null,
      command: installedCommandShim,
      shell: true
    })
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith(installedCommandShim, expect.any(Object))
  })

  it('recognizes a bundled Windows shim through a symlinked bin directory', async () => {
    const bundled = await createBundledBinDirectory()
    const aliasRoot = await mkdtemp(join(os.tmpdir(), 'codori-bundled-bin-alias-'))
    tempDirectories.push(aliasRoot)
    const aliasBin = join(aliasRoot, 'bin')
    await symlink(bundled.bin, aliasBin)
    const installed = await createBinDirectory()
    const installedCommandShim = join(installed.bin, 'codex.cmd')
    await writeFile(installedCommandShim, '@echo off\r\nexit /b 0\r\n')
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      platform: 'win32',
      env: {
        PATH: `${aliasBin};${installed.bin}`,
        PATHEXT: '.CMD'
      },
      bundledPath: bundled.bundledPath,
      execPath: 'C:\\node.exe',
      probe
    })

    expect(executable.path).toBe(installedCommandShim)
    expect(executable.source).toBe('path')
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith(installedCommandShim, expect.any(Object))
  })

  it('keeps an outer installed wrapper eligible for a nested bundle', async () => {
    const bundled = await createNestedBundledBinDirectory()
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      platform: 'win32',
      env: {
        PATH: `${bundled.nestedBin};${bundled.outerBin}`,
        PATHEXT: '.CMD'
      },
      bundledPath: bundled.bundledPath,
      execPath: 'C:\\node.exe',
      probe
    })

    expect(executable.path).toBe(bundled.outerCommandShim)
    expect(executable.source).toBe('path')
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith(
      bundled.outerCommandShim,
      expect.any(Object)
    )
  })

  it('canonicalizes a bundled bin below a symlinked node_modules root', async () => {
    const root = await mkdtemp(join(os.tmpdir(), 'codori-symlinked-node-modules-'))
    tempDirectories.push(root)
    const dependencies = join(root, 'deps')
    const appRoot = join(root, 'app')
    const physicalBin = join(dependencies, '.bin')
    const bundledPath = join(
      appRoot,
      'node_modules',
      '@openai',
      'codex',
      'bin',
      'codex.js'
    )
    const physicalBundledPath = join(
      dependencies,
      '@openai',
      'codex',
      'bin',
      'codex.js'
    )
    await mkdir(physicalBin, { recursive: true })
    await mkdir(dirname(physicalBundledPath), { recursive: true })
    await mkdir(appRoot)
    await writeFile(physicalBundledPath, '#!/usr/bin/env node\n')
    await writeFile(join(physicalBin, 'codex.cmd'), '@echo off\r\nexit /b 0\r\n')
    await symlink(dependencies, join(appRoot, 'node_modules'))

    const installed = await createBinDirectory()
    const installedCommandShim = join(installed.bin, 'codex.cmd')
    await writeFile(installedCommandShim, '@echo off\r\nexit /b 0\r\n')
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      platform: 'win32',
      env: {
        PATH: `${physicalBin};${installed.bin}`,
        PATHEXT: '.CMD'
      },
      bundledPath,
      execPath: 'C:\\node.exe',
      probe
    })

    expect(executable.path).toBe(installedCommandShim)
    expect(executable.source).toBe('path')
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith(installedCommandShim, expect.any(Object))
  })

  it('recovers a package-owned bin after require.resolve canonicalizes a package link', async () => {
    const root = await mkdtemp(join(os.tmpdir(), 'codori-resolved-package-link-'))
    tempDirectories.push(root)
    const serverRoot = join(
      root,
      'app',
      'node_modules',
      '@codori',
      'server'
    )
    const serverEntrypoint = join(serverRoot, 'dist', 'index.js')
    const serverNodeModules = join(serverRoot, 'node_modules')
    const lexicalPackage = join(serverNodeModules, '@openai', 'codex')
    const lexicalBin = join(serverNodeModules, '.bin')
    const physicalPackage = join(root, 'store', '@openai', 'codex')
    const physicalBundledPath = join(physicalPackage, 'bin', 'codex.js')
    await mkdir(dirname(serverEntrypoint), { recursive: true })
    await mkdir(dirname(lexicalPackage), { recursive: true })
    await mkdir(lexicalBin, { recursive: true })
    await mkdir(dirname(physicalBundledPath), { recursive: true })
    await writeFile(serverEntrypoint, '')
    await writeFile(physicalBundledPath, '#!/usr/bin/env node\n')
    await writeFile(
      join(physicalPackage, 'package.json'),
      JSON.stringify({
        name: '@openai/codex',
        exports: { './bin/codex.js': './bin/codex.js' }
      })
    )
    await writeFile(join(lexicalBin, 'codex.cmd'), '@echo off\r\nexit /b 0\r\n')
    await symlink(physicalPackage, lexicalPackage)

    const fixtureRequire = createRequire(pathToFileURL(serverEntrypoint))
    const bundledPath = fixtureRequire.resolve('@openai/codex/bin/codex.js')
    expect(bundledPath).toBe(await realpath(physicalBundledPath))

    const installed = await createBinDirectory()
    const installedCommandShim = join(installed.bin, 'codex.cmd')
    await writeFile(installedCommandShim, '@echo off\r\nexit /b 0\r\n')
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      platform: 'win32',
      env: {
        PATH: `${lexicalBin};${installed.bin}`,
        PATHEXT: '.CMD'
      },
      bundledPath,
      bundledSearchPaths: fixtureRequire.resolve.paths('@openai/codex') ?? [],
      execPath: 'C:\\node.exe',
      probe
    })

    expect(executable.path).toBe(installedCommandShim)
    expect(executable.source).toBe('path')
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith(installedCommandShim, expect.any(Object))
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

  it('keeps searching after a PATH shim resolves to the bundle', async () => {
    const bundled = await createBundledBinDirectory()
    const installed = await createBinDirectory()
    const probe = vi.fn(async () => ({ usable: true as const }))

    const executable = await resolveCodexExecutable({
      env: { PATH: `${bundled.bin}:${installed.bin}` },
      bundledPath: bundled.bundledPath,
      execPath: '/usr/bin/node',
      probe
    })

    expect(executable).toEqual({
      path: installed.candidate,
      source: 'path',
      fallbackReason: null,
      command: installed.candidate,
      argsPrefix: []
    })
    expect(probe).toHaveBeenCalledOnce()
    expect(probe).toHaveBeenCalledWith(installed.candidate, expect.any(Object))
  })

  it('uses the bundle after bundle-equivalent PATH entries are exhausted', async () => {
    const bundled = await createBundledBinDirectory()
    const probe = vi.fn(async () => ({ usable: true as const }))

    await expect(resolveCodexExecutable({
      env: { PATH: bundled.bin },
      bundledPath: bundled.bundledPath,
      execPath: '/usr/bin/node',
      probe
    })).resolves.toEqual({
      path: bundled.bundledPath,
      source: 'bundle',
      fallbackReason: 'path-resolved-to-bundle',
      command: '/usr/bin/node',
      argsPrefix: [bundled.bundledPath]
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
    const bundled = await createBundledBinDirectory()
    const installed = await createBinDirectory()
    const probe = vi.fn(async () => ({ usable: true as const }))
    const resolver = createCodexExecutableResolver({
      env: { PATH: `${bundled.bin}:${installed.bin}` },
      bundledPath: bundled.bundledPath,
      execPath: '/usr/bin/node',
      probe
    })

    const daemonCommand = resolveDaemonStartCommand(true, await resolver())
    const managedCommand = resolveCodexCommand(4765, await resolver(), true)

    expect(daemonCommand.command).toBe(installed.candidate)
    expect(daemonCommand.args).toEqual([
      'remote-control',
      'start',
      '--json',
      '--enable',
      'realtime_conversation'
    ])
    expect(managedCommand.command).toBe(installed.candidate)
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

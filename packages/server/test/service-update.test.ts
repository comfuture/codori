import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  comparePackageVersions,
  checkStartupUpdate,
  CODORI_STARTUP_UPDATE_APPLIED_ENV,
  createServiceUpdateController,
  createUpdateCommand
} from '../src/service-update.js'
import {
  CODORI_SERVICE_INSTALL_ID_ENV,
  CODORI_SERVICE_MANAGED_ENV,
  CODORI_SERVICE_SCOPE_ENV
} from '../src/service.js'

const CURRENT_SERVER_VERSION = (() => {
  const manifest = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8')) as {
    version: string
  }
  return manifest.version
})()

const nextPatchVersion = (version: string) => {
  const [major = '0', minor = '0', patch = '0', ...rest] = version.split('.')
  const nextPatch = Number.parseInt(patch, 10)
  if (Number.isNaN(nextPatch)) {
    throw new Error(`Cannot derive next patch version from "${version}".`)
  }

  return [major, minor, String(nextPatch + 1), ...rest].join('.')
}

const NEWER_SERVER_VERSION = nextPatchVersion(CURRENT_SERVER_VERSION)

describe('service update controller', () => {
  it('compares package versions numerically', () => {
    expect(comparePackageVersions('0.0.4', '0.0.3')).toBeGreaterThan(0)
    expect(comparePackageVersions('1.10.0', '1.2.0')).toBeGreaterThan(0)
    expect(comparePackageVersions('0.0.3', '0.0.3')).toBe(0)
    expect(comparePackageVersions('0.0.2', '0.0.3')).toBeLessThan(0)
  })

  it('stays disabled when the server was not launched by a registered service', async () => {
    const controller = createServiceUpdateController({
      root: '/tmp/demo',
      env: {},
      fetchImpl: vi.fn()
    })

    await expect(controller.getStatus()).resolves.toEqual({
      enabled: false,
      updateAvailable: false,
      updating: false,
      installedVersion: null,
      latestVersion: null
    })
  })

  it('reports update availability for service-managed runs', async () => {
    const controller = createServiceUpdateController({
      root: '/tmp/demo',
      env: {
        [CODORI_SERVICE_MANAGED_ENV]: '1',
        [CODORI_SERVICE_INSTALL_ID_ENV]: 'abc123def456',
        [CODORI_SERVICE_SCOPE_ENV]: 'user'
      },
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          version: NEWER_SERVER_VERSION
        })
      } as Response))
    })

    const status = await controller.getStatus()
    expect(status.enabled).toBe(true)
    expect(status.updateAvailable).toBe(true)
    expect(status.installedVersion).toMatch(/^\d+\.\d+\.\d+/u)
    expect(status.latestVersion).toBe(NEWER_SERVER_VERSION)
    expect(status.updating).toBe(false)
  })

  it('spawns a detached update helper and flips into updating state', async () => {
    const spawnUpdateProcess = vi.fn(async () => undefined)
    const controller = createServiceUpdateController({
      root: '/tmp/demo workspace',
      env: {
        [CODORI_SERVICE_MANAGED_ENV]: '1',
        [CODORI_SERVICE_INSTALL_ID_ENV]: 'abc123def456',
        [CODORI_SERVICE_SCOPE_ENV]: 'system'
      },
      homeDir: '/tmp/service-home',
      npxPath: '/opt/node/bin/npx',
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({
          version: NEWER_SERVER_VERSION
        })
      } as Response)),
      spawnUpdateProcess
    })

    const status = await controller.requestUpdate()

    expect(spawnUpdateProcess).toHaveBeenCalledWith(
      '/bin/sh',
      [
        '-lc',
        expect.stringContaining("'/opt/node/bin/npx' --yes '@codori/server@latest' restart-service --root '/tmp/demo workspace' --scope 'system' --yes")
      ],
      {
        env: expect.objectContaining({
          [CODORI_SERVICE_MANAGED_ENV]: '1',
          [CODORI_SERVICE_INSTALL_ID_ENV]: 'abc123def456',
          [CODORI_SERVICE_SCOPE_ENV]: 'system'
        })
      }
    )
    expect(status.updating).toBe(true)
    expect(status.updateAvailable).toBe(true)
  })
})

const SERVICE_ENV = {
  [CODORI_SERVICE_MANAGED_ENV]: '1',
  [CODORI_SERVICE_INSTALL_ID_ENV]: 'abc123def456',
  [CODORI_SERVICE_SCOPE_ENV]: 'user'
}

const createRegistryFetch = (version: string) => vi.fn(async () => ({
  ok: true,
  json: async () => ({ version })
} as Response))

describe('startup update adoption', () => {
  it('skips the check when the launch is not service-managed', async () => {
    const fetchImpl = vi.fn()
    const result = await checkStartupUpdate({
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch
    })

    expect(result.checked).toBe(false)
    expect(result.reason).toBe('not-service-managed')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('adopts a newer published bundle before serving', async () => {
    const execPackage = vi.fn(async () => undefined)
    const result = await checkStartupUpdate({
      env: SERVICE_ENV,
      fetchImpl: createRegistryFetch(NEWER_SERVER_VERSION) as unknown as typeof fetch,
      execPackage
    })

    expect(result.adopted).toBe(true)
    expect(result.reason).toBe('adopted')
    expect(result.latestVersion).toBe(NEWER_SERVER_VERSION)
    expect(execPackage).toHaveBeenCalledWith(`@codori/server@${NEWER_SERVER_VERSION}`)
  })

  it('does not adopt when the installed bundle is current', async () => {
    const execPackage = vi.fn(async () => undefined)
    const result = await checkStartupUpdate({
      env: SERVICE_ENV,
      fetchImpl: createRegistryFetch(CURRENT_SERVER_VERSION) as unknown as typeof fetch,
      execPackage
    })

    expect(result.adopted).toBe(false)
    expect(result.reason).toBe('up-to-date')
    expect(execPackage).not.toHaveBeenCalled()
  })

  it('serves the installed bundle when the registry is unreachable', async () => {
    const execPackage = vi.fn(async () => undefined)
    const result = await checkStartupUpdate({
      env: SERVICE_ENV,
      fetchImpl: vi.fn(async () => {
        throw new Error('offline')
      }) as unknown as typeof fetch,
      execPackage
    })

    expect(result.reason).toBe('registry-unavailable')
    expect(result.adopted).toBe(false)
    expect(execPackage).not.toHaveBeenCalled()
  })

  it('never re-adopts inside an already adopted launch', async () => {
    const execPackage = vi.fn(async () => undefined)
    const fetchImpl = createRegistryFetch(NEWER_SERVER_VERSION)
    const result = await checkStartupUpdate({
      env: {
        ...SERVICE_ENV,
        [CODORI_STARTUP_UPDATE_APPLIED_ENV]: '1'
      },
      fetchImpl: fetchImpl as unknown as typeof fetch,
      execPackage
    })

    expect(result.checked).toBe(false)
    expect(execPackage).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('platform update command', () => {
  it('uses a POSIX shell on unix', () => {
    const command = createUpdateCommand({ installId: 'abc', scope: 'user' }, {
      root: '/tmp/demo',
      npxPath: '/opt/node/bin/npx',
      homeDir: '/tmp/home',
      platform: 'darwin'
    })

    expect(command.command).toBe('/bin/sh')
    expect(command.args[0]).toBe('-lc')
  })

  it('uses cmd.exe with a timeout delay on windows', () => {
    const command = createUpdateCommand({ installId: 'abc', scope: 'user' }, {
      root: 'C:\\Projects',
      npxPath: 'C:\\Program Files\\nodejs\\npx.cmd',
      homeDir: 'C:\\Users\\test',
      platform: 'win32'
    })

    expect(command.command).toBe('cmd.exe')
    expect(command.args.slice(0, 3)).toEqual(['/d', '/s', '/c'])
    // cmd.exe has no `sleep`.
    expect(command.args[3]).toContain('timeout /t 1 /nobreak')
    expect(command.args[3]).toContain('service restart')
    expect(command.args[3]).toContain('"C:\\Projects"')
  })
})

describe('periodic update polling', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('re-checks the registry on an interval without restarting the service', async () => {
    vi.useFakeTimers()
    const fetchImpl = createRegistryFetch(NEWER_SERVER_VERSION)
    const spawnUpdateProcess = vi.fn(async () => undefined)
    const controller = createServiceUpdateController({
      root: '/tmp/demo',
      env: SERVICE_ENV,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1_000,
      spawnUpdateProcess
    })

    await controller.getStatus()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    controller.startPolling()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    // Discovering an update must never restart on its own.
    expect(spawnUpdateProcess).not.toHaveBeenCalled()

    controller.stopPolling()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does not poll when the launch is not service-managed', async () => {
    vi.useFakeTimers()
    const fetchImpl = createRegistryFetch(NEWER_SERVER_VERSION)
    const controller = createServiceUpdateController({
      root: '/tmp/demo',
      env: {},
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1_000
    })

    controller.startPolling()
    await vi.advanceTimersByTimeAsync(5_000)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

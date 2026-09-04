import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkStartupUpdate,
  comparePackageVersions,
  createServiceUpdateController,
  createUpdateCommand,
  getCurrentServerPackage,
  runServiceUpdateTransaction
} from '../src/service-update.js'
import {
  activateServiceBundleSelection,
  DEFAULT_SERVICE_UPDATE_STALE_TIMEOUT_MS,
  getServiceBundleDirectory,
  getServiceBundleSelectionPath,
  type PrepareServiceBundle,
  type ServiceBundleSelection
} from '../src/service-bundle.js'
import {
  CODORI_SERVICE_INSTALL_ID_ENV,
  CODORI_SERVICE_MANAGED_ENV,
  CODORI_SERVICE_SCOPE_ENV,
  getServiceMetadataDirectory,
  getServiceMetadataPath,
  type ServiceInstallMetadata
} from '../src/service.js'

const CURRENT_SERVER_VERSION = getCurrentServerPackage().version
const nextPatchVersion = (version: string) => {
  const [major = '0', minor = '0', patch = '0'] = version.split('.')
  return `${major}.${minor}.${Number.parseInt(patch, 10) + 1}`
}
const NEWER_SERVER_VERSION = nextPatchVersion(CURRENT_SERVER_VERSION)

const createRegistryFetch = (version: string) => vi.fn(async () => ({
  ok: true,
  json: async () => ({ version })
} as Response))

const createSelection = (
  metadataDirectory: string,
  version: string,
  nodePath = process.execPath
): ServiceBundleSelection => {
  const packageDirectory = join(getServiceBundleDirectory(metadataDirectory, version), 'node_modules', '@codori', 'server')
  mkdirSync(join(packageDirectory, 'dist'), { recursive: true })
  const entrypoint = join(packageDirectory, 'dist', 'cli.js')
  writeFileSync(entrypoint, '#!/usr/bin/env node\n')
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({
    name: '@codori/server',
    version,
    engines: { node: '>=22.22.2' },
    bin: { 'codori-server': 'dist/cli.js' }
  }))
  return { version, entrypoint, nodePath, activatedAt: '2026-09-04T00:00:00.000Z' }
}

const createServiceFixture = () => {
  const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-update-home-'))
  const root = mkdtempSync(join(os.tmpdir(), 'codori-update-root-'))
  const installId = 'abc123def456'
  const metadataDirectory = getServiceMetadataDirectory(installId, homeDir)
  mkdirSync(metadataDirectory, { recursive: true })
  const activeBundle = createSelection(metadataDirectory, CURRENT_SERVER_VERSION)
  activateServiceBundleSelection(metadataDirectory, activeBundle)
  const metadata: ServiceInstallMetadata = {
    installId,
    root,
    host: '127.0.0.1',
    port: 4310,
    scope: 'user',
    platform: 'linux',
    serviceName: 'codori-test.service',
    serviceFilePath: join(metadataDirectory, 'codori-test.service'),
    launcherPath: join(metadataDirectory, 'run-service.sh'),
    installedAt: '2026-09-04T00:00:00.000Z',
    tailscaleServePolicy: 'auto',
    activeBundle,
    updateState: {
      phase: 'healthy',
      targetVersion: CURRENT_SERVER_VERSION,
      activeVersion: CURRENT_SERVER_VERSION,
      failureReason: null,
      updatedAt: '2026-09-04T00:00:00.000Z'
    }
  }
  writeFileSync(getServiceMetadataPath(installId, homeDir), `${JSON.stringify(metadata, null, 2)}\n`)
  return { homeDir, root, installId, metadataDirectory, metadata, activeBundle }
}

const SERVICE_ENV = {
  [CODORI_SERVICE_MANAGED_ENV]: '1',
  [CODORI_SERVICE_INSTALL_ID_ENV]: 'abc123def456',
  [CODORI_SERVICE_SCOPE_ENV]: 'user'
}

describe('service update controller', () => {
  it('compares package versions numerically', () => {
    expect(comparePackageVersions('0.0.4', '0.0.3')).toBeGreaterThan(0)
    expect(comparePackageVersions('1.10.0', '1.2.0')).toBeGreaterThan(0)
    expect(comparePackageVersions('0.0.3', '0.0.3')).toBe(0)
    expect(comparePackageVersions('0.0.2', '0.0.3')).toBeLessThan(0)
  })

  it('stays disabled when the server was not launched by a registered service', async () => {
    const controller = createServiceUpdateController({ root: '/tmp/demo', env: {}, fetchImpl: vi.fn() })
    await expect(controller.getStatus()).resolves.toEqual({
      enabled: false,
      updateAvailable: false,
      updating: false,
      installedVersion: null,
      latestVersion: null,
      durableVersion: null,
      phase: null,
      failureReason: null
    })
  })

  it('persists downloading state and spawns an exact-version worker without npx', async () => {
    const fixture = createServiceFixture()
    const spawnUpdateProcess = vi.fn(async () => undefined)
    const controller = createServiceUpdateController({
      root: fixture.root,
      env: SERVICE_ENV,
      homeDir: fixture.homeDir,
      nodePath: '/opt/node/bin/node',
      platform: 'darwin',
      fetchImpl: createRegistryFetch(NEWER_SERVER_VERSION) as unknown as typeof fetch,
      spawnUpdateProcess
    })

    const status = await controller.requestUpdate()
    expect(spawnUpdateProcess).toHaveBeenCalledWith(
      '/opt/node/bin/node',
      expect.arrayContaining([
        '--install-id', fixture.installId,
        '--root', fixture.root,
        '--scope', 'user',
        '--target-version', NEWER_SERVER_VERSION
      ]),
      { env: SERVICE_ENV }
    )
    expect(JSON.stringify(spawnUpdateProcess.mock.calls[0])).not.toContain('npx')
    expect(status).toMatchObject({
      updating: true,
      phase: 'downloading',
      durableVersion: CURRENT_SERVER_VERSION,
      latestVersion: NEWER_SERVER_VERSION
    })
  })
})

describe('ordinary startup', () => {
  it('never checks the registry or adopts a nested package', async () => {
    const fetchImpl = vi.fn()
    const execPackage = vi.fn()
    const result = await checkStartupUpdate({ env: SERVICE_ENV, fetchImpl, execPackage })
    expect(result.reason).toBe('durable-launch')
    expect(result.adopted).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(execPackage).not.toHaveBeenCalled()
  })
})

describe('platform update command', () => {
  it('uses a transient systemd unit on Linux so service restarts cannot kill the worker', () => {
    for (const scope of ['user', 'system'] as const) {
      const command = createUpdateCommand({ installId: 'abc', scope }, {
        root: '/tmp/demo',
        nodePath: '/opt/node/bin/node',
        homeDir: '/tmp/home',
        platform: 'linux',
        targetVersion: '1.2.3'
      })
      expect(command.command).toBe('systemd-run')
      expect(command.args).toEqual(expect.arrayContaining([
        '--collect',
        '--property=Type=exec',
        '--',
        '/opt/node/bin/node',
        '--target-version',
        '1.2.3'
      ]))
      expect(command.args.some(value => value.startsWith('--unit=codori-update-abc-'))).toBe(true)
      expect(command.args.includes('--user')).toBe(scope === 'user')
      expect(command.args.join(' ')).not.toContain('latest')
      expect(command.args.join(' ')).not.toContain('npx')
    }
  })

  it('uses the pinned Node worker with the exact target on macOS and Windows', () => {
    for (const platform of ['darwin', 'win32'] as NodeJS.Platform[]) {
      const command = createUpdateCommand({ installId: 'abc', scope: 'system' }, {
        root: '/tmp/demo',
        nodePath: '/opt/node/bin/node',
        homeDir: '/tmp/home',
        platform,
        targetVersion: '1.2.3'
      })
      expect(command.command).toBe('/opt/node/bin/node')
      expect(command.args).toContain('1.2.3')
      expect(command.args).toContain('/tmp/home')
      expect(command.args.join(' ')).not.toContain('latest')
      expect(command.args.join(' ')).not.toContain('npx')
    }
  })
})

describe('abandoned update recovery', () => {
  const staleUpdatedAt = new Date(Date.now() - DEFAULT_SERVICE_UPDATE_STALE_TIMEOUT_MS - 1_000).toISOString()

  it('expires a stale downloading lease and allows a retry', async () => {
    const fixture = createServiceFixture()
    writeFileSync(getServiceMetadataPath(fixture.installId, fixture.homeDir), `${JSON.stringify({
      ...fixture.metadata,
      updateState: {
        phase: 'downloading',
        targetVersion: NEWER_SERVER_VERSION,
        activeVersion: CURRENT_SERVER_VERSION,
        failureReason: null,
        updatedAt: staleUpdatedAt
      }
    }, null, 2)}\n`)
    const spawnUpdateProcess = vi.fn(async () => undefined)
    const controller = createServiceUpdateController({
      root: fixture.root,
      env: SERVICE_ENV,
      homeDir: fixture.homeDir,
      platform: 'darwin',
      fetchImpl: createRegistryFetch(NEWER_SERVER_VERSION) as unknown as typeof fetch,
      spawnUpdateProcess
    })

    await expect(controller.getStatus()).resolves.toMatchObject({
      updating: false,
      phase: 'failed',
      failureReason: expect.stringContaining('lease expired')
    })
    await expect(controller.requestUpdate()).resolves.toMatchObject({ updating: true, phase: 'downloading' })
    expect(spawnUpdateProcess).toHaveBeenCalledTimes(1)
  })

  it('marks a stale restart healthy when the exact target is serving durably', async () => {
    const fixture = createServiceFixture()
    writeFileSync(getServiceMetadataPath(fixture.installId, fixture.homeDir), `${JSON.stringify({
      ...fixture.metadata,
      updateState: {
        phase: 'restarting',
        targetVersion: CURRENT_SERVER_VERSION,
        activeVersion: CURRENT_SERVER_VERSION,
        failureReason: null,
        updatedAt: staleUpdatedAt
      }
    }, null, 2)}\n`)
    const controller = createServiceUpdateController({
      root: fixture.root,
      env: SERVICE_ENV,
      homeDir: fixture.homeDir,
      fetchImpl: createRegistryFetch(CURRENT_SERVER_VERSION) as unknown as typeof fetch
    })

    await expect(controller.getStatus()).resolves.toMatchObject({
      updating: false,
      phase: 'healthy',
      durableVersion: CURRENT_SERVER_VERSION,
      failureReason: null
    })
  })

  it('records rollback when the bootstrap restored the previous exact bundle', async () => {
    const fixture = createServiceFixture()
    const failedTarget = createSelection(fixture.metadataDirectory, NEWER_SERVER_VERSION)
    writeFileSync(getServiceMetadataPath(fixture.installId, fixture.homeDir), `${JSON.stringify({
      ...fixture.metadata,
      activeBundle: failedTarget,
      previousBundle: fixture.activeBundle,
      updateState: {
        phase: 'restarting',
        targetVersion: NEWER_SERVER_VERSION,
        activeVersion: NEWER_SERVER_VERSION,
        failureReason: null,
        updatedAt: staleUpdatedAt
      }
    }, null, 2)}\n`)
    const controller = createServiceUpdateController({
      root: fixture.root,
      env: SERVICE_ENV,
      homeDir: fixture.homeDir,
      fetchImpl: createRegistryFetch(CURRENT_SERVER_VERSION) as unknown as typeof fetch
    })

    await expect(controller.getStatus()).resolves.toMatchObject({
      updating: false,
      phase: 'rolled-back',
      durableVersion: CURRENT_SERVER_VERSION,
      failureReason: expect.stringContaining('lease expired')
    })
    expect(JSON.parse(readFileSync(getServiceMetadataPath(fixture.installId, fixture.homeDir), 'utf8')))
      .toMatchObject({ activeBundle: { version: CURRENT_SERVER_VERSION }, previousBundle: { version: NEWER_SERVER_VERSION } })
  })
})

describe('durable update transaction', () => {
  it('keeps the current selection and listener untouched when preparation fails', async () => {
    const fixture = createServiceFixture()
    const restart = vi.fn(async () => undefined)
    await expect(runServiceUpdateTransaction({
      installId: fixture.installId,
      root: fixture.root,
      scope: 'user',
      homeDir: fixture.homeDir,
      targetVersion: NEWER_SERVER_VERSION
    }, {
      prepareBundle: vi.fn(async () => { throw new Error('registry unavailable') }),
      restart
    })).rejects.toThrow('registry unavailable')
    expect(restart).not.toHaveBeenCalled()
    expect(JSON.parse(readFileSync(getServiceBundleSelectionPath(fixture.metadataDirectory), 'utf8')).version)
      .toBe(CURRENT_SERVER_VERSION)
    expect(JSON.parse(readFileSync(getServiceMetadataPath(fixture.installId, fixture.homeDir), 'utf8')).updateState)
      .toMatchObject({ phase: 'failed', failureReason: 'registry unavailable' })
  })

  it('bounds a hanging preparation before any restart', async () => {
    const fixture = createServiceFixture()
    const restart = vi.fn(async () => undefined)
    await expect(runServiceUpdateTransaction({
      installId: fixture.installId,
      root: fixture.root,
      scope: 'user',
      homeDir: fixture.homeDir,
      targetVersion: NEWER_SERVER_VERSION,
      preparationTimeoutMs: 10
    }, {
      prepareBundle: vi.fn(() => new Promise<ServiceBundleSelection>(() => {})),
      restart
    })).rejects.toThrow('Timed out preparing target bundle')
    expect(restart).not.toHaveBeenCalled()
  })

  it('migrates a legacy launcher to the current exact bundle before selecting the target', async () => {
    const fixture = createServiceFixture()
    rmSync(getServiceBundleSelectionPath(fixture.metadataDirectory))
    const legacyMetadata = { ...fixture.metadata }
    delete legacyMetadata.activeBundle
    delete legacyMetadata.updateState
    writeFileSync(
      getServiceMetadataPath(fixture.installId, fixture.homeDir),
      `${JSON.stringify(legacyMetadata, null, 2)}\n`
    )
    const preparedVersions: string[] = []
    const prepareBundle: PrepareServiceBundle = async options => {
      preparedVersions.push(options.version)
      return createSelection(options.metadataDirectory, options.version, options.nodePath)
    }
    const restart = vi.fn(async () => {
      const launcher = readFileSync(fixture.metadata.launcherPath, 'utf8')
      expect(launcher).toContain('launch-service.cjs')
      expect(launcher).not.toContain('npx')
      expect(JSON.parse(readFileSync(getServiceBundleSelectionPath(fixture.metadataDirectory), 'utf8')).version)
        .toBe(NEWER_SERVER_VERSION)
    })
    const result = await runServiceUpdateTransaction({
      installId: fixture.installId,
      root: fixture.root,
      scope: 'user',
      homeDir: fixture.homeDir,
      targetVersion: NEWER_SERVER_VERSION
    }, {
      prepareBundle,
      restart,
      fetchImpl: vi.fn(async () => ({
        ok: true,
        json: async () => ({ serviceUpdate: { installedVersion: NEWER_SERVER_VERSION, durableVersion: NEWER_SERVER_VERSION } })
      } as Response)) as typeof fetch
    })
    expect(preparedVersions).toEqual([CURRENT_SERVER_VERSION, NEWER_SERVER_VERSION])
    expect(result.updateState?.phase).toBe('healthy')
  })

  it('atomically selects the exact target, waits through downtime, and cleans stale bundles', async () => {
    const fixture = createServiceFixture()
    createSelection(fixture.metadataDirectory, '0.0.1')
    mkdirSync(join(fixture.metadataDirectory, 'bundles', '.staging-abandoned'), { recursive: true })
    const prepareBundle: PrepareServiceBundle = vi.fn(async options => createSelection(
      options.metadataDirectory,
      options.version,
      options.nodePath
    ))
    const restart = vi.fn(async () => {
      expect(JSON.parse(readFileSync(getServiceBundleSelectionPath(fixture.metadataDirectory), 'utf8')).version)
        .toBe(NEWER_SERVER_VERSION)
    })
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue({
        ok: true,
        json: async () => ({ serviceUpdate: { installedVersion: NEWER_SERVER_VERSION, durableVersion: NEWER_SERVER_VERSION } })
      } as Response)
    let milliseconds = 0
    const result = await runServiceUpdateTransaction({
      installId: fixture.installId,
      root: fixture.root,
      scope: 'user',
      homeDir: fixture.homeDir,
      targetVersion: NEWER_SERVER_VERSION,
      healthTimeoutMs: 100,
      healthPollIntervalMs: 5
    }, {
      prepareBundle,
      restart,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date(milliseconds),
      delay: async value => { milliseconds += value }
    })
    expect(result.updateState).toMatchObject({ phase: 'healthy', activeVersion: NEWER_SERVER_VERSION })
    expect(restart).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(existsSync(getServiceBundleDirectory(fixture.metadataDirectory, '0.0.1'))).toBe(false)
    expect(existsSync(join(fixture.metadataDirectory, 'bundles', '.staging-abandoned'))).toBe(false)
    expect(existsSync(getServiceBundleDirectory(fixture.metadataDirectory, CURRENT_SERVER_VERSION))).toBe(true)
    expect(existsSync(getServiceBundleDirectory(fixture.metadataDirectory, NEWER_SERVER_VERSION))).toBe(true)
    const updateLog = readFileSync(join(fixture.metadataDirectory, 'update.log'), 'utf8')
    expect(updateLog).toContain('"phase":"downloading"')
    expect(updateLog).toContain('"phase":"restarting"')
    expect(updateLog).toContain('"phase":"healthy"')
  })

  it('rolls back when the target reports the wrong version', async () => {
    const fixture = createServiceFixture()
    const prepareBundle: PrepareServiceBundle = vi.fn(async options => createSelection(
      options.metadataDirectory,
      options.version,
      options.nodePath
    ))
    const restart = vi.fn(async () => undefined)
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        serviceUpdate: restart.mock.calls.length >= 2
          ? { installedVersion: CURRENT_SERVER_VERSION, durableVersion: CURRENT_SERVER_VERSION }
          : { installedVersion: '9.9.9', durableVersion: NEWER_SERVER_VERSION }
      })
    } as Response))
    let milliseconds = 0
    const result = await runServiceUpdateTransaction({
      installId: fixture.installId,
      root: fixture.root,
      scope: 'user',
      homeDir: fixture.homeDir,
      targetVersion: NEWER_SERVER_VERSION,
      healthTimeoutMs: 10,
      healthPollIntervalMs: 5
    }, {
      prepareBundle,
      restart,
      fetchImpl: fetchImpl as typeof fetch,
      now: () => new Date(milliseconds),
      delay: async value => { milliseconds += value }
    })
    expect(result.updateState).toMatchObject({
      phase: 'rolled-back',
      activeVersion: CURRENT_SERVER_VERSION,
      failureReason: expect.stringContaining('service reported 9.9.9')
    })
    expect(restart).toHaveBeenCalledTimes(2)
    expect(JSON.parse(readFileSync(getServiceBundleSelectionPath(fixture.metadataDirectory), 'utf8')).version)
      .toBe(CURRENT_SERVER_VERSION)
    expect(readFileSync(join(fixture.metadataDirectory, 'update.log'), 'utf8'))
      .toContain('"phase":"rolled-back"')
  })
})

describe('periodic update polling', () => {
  afterEach(() => vi.useRealTimers())

  it('re-checks the registry without restarting the service', async () => {
    vi.useFakeTimers()
    const fixture = createServiceFixture()
    const fetchImpl = createRegistryFetch(NEWER_SERVER_VERSION)
    const spawnUpdateProcess = vi.fn(async () => undefined)
    const controller = createServiceUpdateController({
      root: fixture.root,
      env: SERVICE_ENV,
      homeDir: fixture.homeDir,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      pollIntervalMs: 1_000,
      spawnUpdateProcess
    })
    await controller.getStatus()
    controller.startPolling()
    await vi.advanceTimersByTimeAsync(2_000)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(spawnUpdateProcess).not.toHaveBeenCalled()
    controller.stopPolling()
  })
})

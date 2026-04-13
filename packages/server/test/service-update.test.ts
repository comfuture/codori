import { describe, expect, it, vi } from 'vitest'
import {
  comparePackageVersions,
  createServiceUpdateController
} from '../src/service-update.js'
import {
  CODORI_SERVICE_INSTALL_ID_ENV,
  CODORI_SERVICE_MANAGED_ENV,
  CODORI_SERVICE_SCOPE_ENV
} from '../src/service.js'

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
          version: '0.0.9'
        })
      } as Response))
    })

    const status = await controller.getStatus()
    expect(status.enabled).toBe(true)
    expect(status.updateAvailable).toBe(true)
    expect(status.installedVersion).toMatch(/^\d+\.\d+\.\d+/u)
    expect(status.latestVersion).toBe('0.0.9')
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
          version: '0.0.9'
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

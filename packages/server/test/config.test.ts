import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'

const createdDirectories: string[] = []

afterEach(() => {
  createdDirectories.splice(0, createdDirectories.length).forEach(() => {})
})

const createHome = () => {
  const homeDir = mkdtempSync(join(os.tmpdir(), 'codori-home-'))
  createdDirectories.push(homeDir)
  return homeDir
}

describe('resolveConfig', () => {
  it('uses localhost defaults when server host and port are not provided', () => {
    const homeDir = createHome()

    const config = resolveConfig({
      root: '/tmp/from-cli'
    }, homeDir)

    expect(config.server.host).toBe('127.0.0.1')
    expect(config.server.port).toBe(4310)
    expect(config.idleShutdown).toEqual({
      enabled: true,
      timeoutMs: 30 * 60 * 1000,
      sweepIntervalMs: 60 * 1000
    })
  })

  it('uses overrides ahead of file config', () => {
    const homeDir = createHome()
    const codoriDir = join(homeDir, '.codori')
    mkdirSync(codoriDir, { recursive: true })
    writeFileSync(join(codoriDir, 'config.json'), JSON.stringify({
      root: '/tmp/from-file',
      server: {
        host: '127.0.0.1',
        port: 5000
      }
    }))

    const config = resolveConfig({
      root: '/tmp/from-cli',
      port: 4100
    }, homeDir)

    expect(config.root).toBe('/tmp/from-cli')
    expect(config.server.host).toBe('127.0.0.1')
    expect(config.server.port).toBe(4100)
  })

  it('reads idle shutdown configuration from the user config file', () => {
    const homeDir = createHome()
    const codoriDir = join(homeDir, '.codori')
    mkdirSync(codoriDir, { recursive: true })
    writeFileSync(join(codoriDir, 'config.json'), JSON.stringify({
      root: '/tmp/from-file',
      idleShutdown: {
        enabled: false,
        timeoutMs: 5_000,
        sweepIntervalMs: 2_000
      }
    }))

    const config = resolveConfig({}, homeDir)

    expect(config.idleShutdown).toEqual({
      enabled: false,
      timeoutMs: 5_000,
      sweepIntervalMs: 2_000
    })
  })

  it('lets cli overrides replace idle shutdown config values', () => {
    const homeDir = createHome()
    const codoriDir = join(homeDir, '.codori')
    mkdirSync(codoriDir, { recursive: true })
    writeFileSync(join(codoriDir, 'config.json'), JSON.stringify({
      root: '/tmp/from-file',
      idleShutdown: {
        enabled: true,
        timeoutMs: 10_000,
        sweepIntervalMs: 5_000
      }
    }))

    const config = resolveConfig({
      idleShutdownEnabled: false,
      idleShutdownTimeoutMs: 45_000,
      idleShutdownSweepIntervalMs: 15_000
    }, homeDir)

    expect(config.idleShutdown).toEqual({
      enabled: false,
      timeoutMs: 45_000,
      sweepIntervalMs: 15_000
    })
  })

  it('validates idle shutdown overrides the same way as file config', () => {
    const homeDir = createHome()

    expect(() => resolveConfig({
      root: '/tmp/from-cli',
      idleShutdownTimeoutMs: 0 as number
    }, homeDir)).toThrow(/idleShutdown\.timeoutMs/)
    expect(() => resolveConfig({
      root: '/tmp/from-cli',
      idleShutdownEnabled: 'yes' as unknown as boolean
    }, homeDir)).toThrow(/idleShutdown\.enabled/)
  })
})

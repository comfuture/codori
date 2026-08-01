import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  resolveCodoriConfigPath,
  resolveConfig,
  resolveLastServiceRoot,
  writeLastServiceRoot,
  writeProjectRoot
} from '../src/config.js'

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
    expect(config.realtimeVoice).toEqual({
      enabled: true
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

  it('reads experimental realtime voice config and lets cli enable it', () => {
    const homeDir = createHome()
    const codoriDir = join(homeDir, '.codori')
    mkdirSync(codoriDir, { recursive: true })
    writeFileSync(join(codoriDir, 'config.json'), JSON.stringify({
      root: '/tmp/from-file',
      realtimeVoice: {
        enabled: false
      }
    }))

    expect(resolveConfig({}, homeDir).realtimeVoice.enabled).toBe(false)
    expect(resolveConfig({ realtimeVoiceEnabled: true }, homeDir).realtimeVoice.enabled).toBe(true)
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
    expect(() => resolveConfig({
      root: '/tmp/from-cli',
      realtimeVoiceEnabled: 'yes' as unknown as boolean
    }, homeDir)).toThrow(/realtimeVoice\.enabled/)
  })
})

describe('project root persistence', () => {
  it('writes the root without discarding unrelated config keys', () => {
    const homeDir = createHome()
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    createdDirectories.push(root)

    mkdirSync(join(homeDir, '.codori'), { recursive: true })
    writeFileSync(
      resolveCodoriConfigPath(homeDir),
      JSON.stringify({
        root: '/tmp/previous',
        server: { host: '0.0.0.0', port: 4400 },
        realtimeVoice: { enabled: false }
      }),
      'utf8'
    )

    expect(writeProjectRoot(root, homeDir)).toBe(root)

    const persisted = JSON.parse(readFileSync(resolveCodoriConfigPath(homeDir), 'utf8'))
    expect(persisted.root).toBe(root)
    expect(persisted.server).toEqual({ host: '0.0.0.0', port: 4400 })
    expect(persisted.realtimeVoice).toEqual({ enabled: false })

    // The persisted value must be what a later resolveConfig picks up.
    expect(resolveConfig({}, homeDir).root).toBe(root)
  })

  it('rejects a root that is missing or not a directory', () => {
    const homeDir = createHome()
    const root = mkdtempSync(join(os.tmpdir(), 'codori-root-'))
    createdDirectories.push(root)
    const filePath = join(root, 'not-a-directory.txt')
    writeFileSync(filePath, 'x', 'utf8')

    expect(() => writeProjectRoot(join(root, 'missing'), homeDir))
      .toThrow(/does not exist or is not a directory/)
    expect(() => writeProjectRoot(filePath, homeDir))
      .toThrow(/does not exist or is not a directory/)
  })

  it('remembers and reads back the last served root', () => {
    const homeDir = createHome()

    expect(resolveLastServiceRoot(homeDir)).toBeNull()
    writeLastServiceRoot('/tmp/served-root', homeDir)
    expect(resolveLastServiceRoot(homeDir)).toBe('/tmp/served-root')
  })

  it('ignores a malformed last-root record', () => {
    const homeDir = createHome()
    mkdirSync(join(homeDir, '.codori'), { recursive: true })
    writeFileSync(join(homeDir, '.codori', 'last-root.json'), '{ not json', 'utf8')

    expect(resolveLastServiceRoot(homeDir)).toBeNull()
  })
})

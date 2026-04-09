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
})


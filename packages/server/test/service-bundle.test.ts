import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  activateServiceBundleSelection,
  DEFAULT_SERVICE_UPDATE_STALE_TIMEOUT_MS,
  ensureServiceBundleBootstrap,
  getServiceBundleDirectory,
  getServiceBundleSelectionPath,
  prepareServiceBundle,
  readServiceBundleSelection,
  satisfiesNodeEngine,
  type ServiceBundleSelection
} from '../src/service-bundle.js'

const seedBundle = (
  metadataDirectory: string,
  directoryVersion: string,
  manifestVersion = directoryVersion,
  nodeEngine = '>=22.22.2'
) => {
  const packageDirectory = join(
    getServiceBundleDirectory(metadataDirectory, directoryVersion),
    'node_modules',
    '@codori',
    'server'
  )
  mkdirSync(join(packageDirectory, 'dist'), { recursive: true })
  writeFileSync(join(packageDirectory, 'dist', 'cli.js'), '#!/usr/bin/env node\n')
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({
    name: '@codori/server',
    version: manifestVersion,
    engines: { node: nodeEngine },
    bin: { 'codori-server': 'dist/cli.js' }
  }))
}

describe('managed service bundles', () => {
  it('validates and selects an existing exact package without invoking npm', async () => {
    const metadataDirectory = mkdtempSync(join(os.tmpdir(), 'codori-bundle-'))
    seedBundle(metadataDirectory, '1.2.3')
    const selection = await prepareServiceBundle({
      metadataDirectory,
      version: '1.2.3',
      nodePath: process.execPath,
      npmPath: '/path/that/must/not/run'
    })
    expect(selection).toMatchObject({ version: '1.2.3', nodePath: process.execPath })
    expect(selection.entrypoint).toBe(
      join(getServiceBundleDirectory(metadataDirectory, '1.2.3'), 'node_modules', '@codori', 'server', 'dist', 'cli.js')
    )
  })

  it('prepares a service bundle using the published Node engine range', async () => {
    const metadataDirectory = mkdtempSync(join(os.tmpdir(), 'codori-bundle-engine-'))
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      engines: { node: string }
    }
    seedBundle(metadataDirectory, '1.2.3', '1.2.3', manifest.engines.node)

    await expect(prepareServiceBundle({
      metadataDirectory,
      version: '1.2.3',
      nodePath: process.execPath,
      npmPath: '/path/that/must/not/run'
    })).resolves.toMatchObject({ version: '1.2.3', nodePath: process.execPath })
  })

  it('rejects a staged directory whose manifest does not match the requested version', async () => {
    const metadataDirectory = mkdtempSync(join(os.tmpdir(), 'codori-bundle-'))
    seedBundle(metadataDirectory, '1.2.3', '1.2.2')
    await expect(prepareServiceBundle({
      metadataDirectory,
      version: '1.2.3',
      nodePath: process.execPath,
      npmPath: '/path/that/must/not/run'
    })).rejects.toThrow('@codori/server@1.2.3')
  })

  it('atomically points the service-owned bootstrap at an exact absolute entrypoint', () => {
    const metadataDirectory = mkdtempSync(join(os.tmpdir(), 'codori-bundle-'))
    const selection: ServiceBundleSelection = {
      version: '1.2.3',
      entrypoint: join(metadataDirectory, 'bundles', '1.2.3', 'node_modules', '@codori', 'server', 'dist', 'cli.js'),
      nodePath: process.execPath,
      activatedAt: '2026-09-04T00:00:00.000Z'
    }
    activateServiceBundleSelection(metadataDirectory, selection)
    const bootstrapPath = ensureServiceBundleBootstrap(metadataDirectory)
    expect(readServiceBundleSelection(metadataDirectory)).toEqual(selection)
    expect(readFileSync(getServiceBundleSelectionPath(metadataDirectory), 'utf8')).toContain('"version": "1.2.3"')
    const bootstrap = readFileSync(bootstrapPath, 'utf8')
    expect(bootstrap).toContain(getServiceBundleSelectionPath(metadataDirectory))
    expect(bootstrap).not.toContain('npx')
  })

  it('atomically restores the previous bundle when a restart lease was abandoned', () => {
    const metadataDirectory = mkdtempSync(join(os.tmpdir(), 'codori-bundle-'))
    const markerPath = join(metadataDirectory, 'started.txt')
    const createRunnableSelection = (version: string, marker: string): ServiceBundleSelection => {
      const entrypoint = join(metadataDirectory, `${marker}.cjs`)
      writeFileSync(entrypoint, `require('node:fs').writeFileSync(${JSON.stringify(markerPath)}, ${JSON.stringify(marker)})\n`)
      return { version, entrypoint, nodePath: process.execPath, activatedAt: new Date().toISOString() }
    }
    const previous = createRunnableSelection('1.2.2', 'previous')
    const target = createRunnableSelection('1.2.3', 'target')
    activateServiceBundleSelection(metadataDirectory, target, previous)
    writeFileSync(join(metadataDirectory, 'service.json'), `${JSON.stringify({
      updateState: {
        phase: 'restarting',
        updatedAt: new Date(Date.now() - DEFAULT_SERVICE_UPDATE_STALE_TIMEOUT_MS - 1_000).toISOString()
      }
    })}\n`)

    const result = spawnSync(process.execPath, [ensureServiceBundleBootstrap(metadataDirectory)], { encoding: 'utf8' })

    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(markerPath, 'utf8')).toBe('previous')
    expect(readServiceBundleSelection(metadataDirectory)).toEqual(previous)
    expect(readFileSync(join(metadataDirectory, 'update.log'), 'utf8')).toContain('"phase":"bootstrap-rollback"')
  })
})

describe('Node engine compatibility', () => {
  const supportedRange = '^22.22.3 || ^24.15.0 || >=26.0.0'

  it.each(['22.22.3', 'v22.23.0', '24.15.0', 'v24.19.0', '26.0.0', '27.0.0'])(
    'accepts supported Node %s',
    version => expect(satisfiesNodeEngine(supportedRange, version)).toBe(true)
  )

  it.each(['20.20.0', '22.22.2', '23.0.0', '24.14.9', '25.0.0', '26.0.0-rc.1'])(
    'rejects unsupported Node %s',
    version => expect(satisfiesNodeEngine(supportedRange, version)).toBe(false)
  )

  it.each(['', 'not-a-version', 'v24', '24.15', '24.15.0junk', '24.15.0.1'])(
    'rejects malformed Node version %j',
    version => expect(satisfiesNodeEngine(supportedRange, version)).toBe(false)
  )

  it.each(['', '   ', 'not-a-range', '>=22.22.2 garbage', '^22.22.3 || invalid'])(
    'rejects empty or malformed engine range %j',
    range => expect(satisfiesNodeEngine(range, '24.19.0')).toBe(false)
  )

  it('keeps the published range equivalent while allowing legacy updaters to parse its minimum', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      engines: { node: string }
    }
    // Existing installations run this minimum-only check before activating the new bundle.
    // Preserve its accepted prefix, while the new validator enforces every range branch.
    const legacyMinimum = manifest.engines.node.match(/^>=\s*(\d+\.\d+\.\d+)/u)?.[1]
    expect(legacyMinimum).toBe('22.22.3')
    for (const version of ['22.22.3', '24.15.0', '26.0.0']) {
      const required = legacyMinimum!.split('.').map(Number)
      const actual = version.split('.').map(Number)
      const firstDifference = actual.findIndex((part, index) => part !== required[index])
      expect(firstDifference === -1 || actual[firstDifference] > required[firstDifference], version).toBe(true)
    }
    for (const version of [
      '22.22.2', '22.22.3', '22.23.0', '23.0.0-rc.1', '23.0.0',
      '24.14.9', '24.15.0', '24.19.0', '25.0.0-rc.1', '25.0.0',
      '26.0.0-rc.1', '26.0.0', '27.0.0'
    ]) {
      expect(satisfiesNodeEngine(manifest.engines.node, version), version)
        .toBe(satisfiesNodeEngine(supportedRange, version))
    }
  })

  it('preserves legacy minimum-version ranges without ignoring upper bounds', () => {
    expect(satisfiesNodeEngine('>=22.22.2', 'v22.22.2')).toBe(true)
    expect(satisfiesNodeEngine('>=22.22.2', '24.19.0')).toBe(true)
    expect(satisfiesNodeEngine('>=22.22.2', '22.22.1')).toBe(false)
    expect(satisfiesNodeEngine('>=22.22.2 <24', '24.19.0')).toBe(false)
  })
})

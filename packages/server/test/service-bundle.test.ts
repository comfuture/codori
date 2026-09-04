import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  activateServiceBundleSelection,
  ensureServiceBundleBootstrap,
  getServiceBundleDirectory,
  getServiceBundleSelectionPath,
  prepareServiceBundle,
  readServiceBundleSelection,
  type ServiceBundleSelection
} from '../src/service-bundle.js'

const seedBundle = (metadataDirectory: string, directoryVersion: string, manifestVersion = directoryVersion) => {
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
    engines: { node: '>=22.22.2' },
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
})

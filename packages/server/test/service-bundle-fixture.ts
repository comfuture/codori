import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getServiceBundleDirectory, type PrepareServiceBundle } from '../src/service-bundle.js'

export const prepareTestServiceBundle: PrepareServiceBundle = async (options) => {
  const packageDirectory = join(
    getServiceBundleDirectory(options.metadataDirectory, options.version),
    'node_modules',
    '@codori',
    'server'
  )
  const entrypoint = join(packageDirectory, 'dist', 'cli.js')
  mkdirSync(join(packageDirectory, 'dist'), { recursive: true })
  writeFileSync(entrypoint, '#!/usr/bin/env node\n')
  writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify({
    name: '@codori/server',
    version: options.version,
    engines: { node: '>=22.22.2' },
    bin: { 'codori-server': 'dist/cli.js' }
  }))
  return {
    version: options.version,
    entrypoint,
    nodePath: options.nodePath,
    activatedAt: (options.now ?? (() => new Date()))().toISOString()
  }
}

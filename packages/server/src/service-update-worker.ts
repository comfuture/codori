#!/usr/bin/env node
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { getServiceMetadataDirectory, type ServiceScope } from './service.js'
import { runServiceUpdateTransaction } from './service-update.js'

const main = async () => {
  const parsed = parseArgs({
    args: process.argv.slice(2),
    options: {
      'install-id': { type: 'string' },
      root: { type: 'string' },
      scope: { type: 'string' },
      home: { type: 'string' },
      'target-version': { type: 'string' }
    }
  })
  const installId = parsed.values['install-id']
  const root = parsed.values.root
  const scope = parsed.values.scope
  const homeDir = parsed.values.home
  const targetVersion = parsed.values['target-version']
  if (!installId || !root || (scope !== 'user' && scope !== 'system') || !homeDir || !targetVersion) {
    throw new Error('Service update worker arguments are incomplete.')
  }
  await runServiceUpdateTransaction({
    installId,
    root,
    scope: scope as ServiceScope,
    homeDir,
    targetVersion
  })
}

main().catch((error) => {
  const args = process.argv.slice(2)
  const installIndex = args.indexOf('--install-id')
  const homeIndex = args.indexOf('--home')
  const installId = installIndex >= 0 ? args[installIndex + 1] : undefined
  const homeDir = homeIndex >= 0 ? args[homeIndex + 1] : undefined
  if (installId && homeDir) {
    try {
      appendFileSync(
        join(getServiceMetadataDirectory(installId, homeDir), 'update.log'),
        `${JSON.stringify({
          timestamp: new Date().toISOString(),
          phase: 'worker-failed',
          failureReason: error instanceof Error ? error.stack ?? error.message : String(error)
        })}\n`,
        'utf8'
      )
    } catch {
      // The worker cannot recover if its service metadata directory is gone.
    }
  }
  process.exitCode = 1
})

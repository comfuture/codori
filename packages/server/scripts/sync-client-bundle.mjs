import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(scriptDir, '..')
const clientSourceDir = resolve(packageDir, '../client/.output/public')
const webxrSourceDir = resolve(packageDir, '../webxr/dist')
const targetDir = resolve(packageDir, 'client-dist')
const webxrTargetDir = resolve(targetDir, 'xr')
const bundles = [
  {
    name: 'client',
    sourceDir: clientSourceDir,
    indexPath: resolve(clientSourceDir, 'index.html'),
    requiredPaths: [
      resolve(clientSourceDir, 'index.html'),
      resolve(clientSourceDir, 'sw.js')
    ],
    buildCommand: 'pnpm --filter @codori/client build'
  },
  {
    name: 'WebXR',
    sourceDir: webxrSourceDir,
    indexPath: resolve(webxrSourceDir, 'index.html'),
    requiredPaths: [resolve(webxrSourceDir, 'index.html')],
    buildCommand: 'pnpm --filter @codori/webxr build'
  }
]

for (const bundle of bundles) {
  const missingPath = bundle.requiredPaths.find(path => !existsSync(path))
  if (missingPath) {
    process.stderr.write(
      `Missing ${bundle.name} bundle artifact at ${missingPath}. Run "${bundle.buildCommand}" before building @codori/server.\n`
    )
    process.exit(1)
  }
}

rmSync(targetDir, { recursive: true, force: true })
mkdirSync(targetDir, { recursive: true })
cpSync(clientSourceDir, targetDir, { recursive: true })
mkdirSync(webxrTargetDir, { recursive: true })
cpSync(webxrSourceDir, webxrTargetDir, { recursive: true })

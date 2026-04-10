import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageDir = resolve(scriptDir, '..')
const sourceDir = resolve(packageDir, '../client/.output/public')
const targetDir = resolve(packageDir, 'client-dist')
const sourceIndexPath = resolve(sourceDir, 'index.html')

if (!existsSync(sourceIndexPath)) {
  process.stderr.write(
    `Missing client bundle at ${sourceIndexPath}. Run "pnpm --filter @codori/client build" before building @codori/server.\n`
  )
  process.exit(1)
}

rmSync(targetDir, { recursive: true, force: true })
mkdirSync(targetDir, { recursive: true })
cpSync(sourceDir, targetDir, { recursive: true })

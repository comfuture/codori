import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export const SERVICE_PACKAGE_NAME = '@codori/server'
export const DEFAULT_BUNDLE_PREPARATION_TIMEOUT_MS = 2 * 60 * 1_000
const PACKAGE_MANIFEST_PATH = fileURLToPath(new URL('../package.json', import.meta.url))

export type ServiceBundleSelection = {
  version: string
  entrypoint: string
  nodePath: string
  activatedAt: string
}

export type PrepareServiceBundleOptions = {
  metadataDirectory: string
  version: string
  nodePath: string
  npmPath: string
  timeoutMs?: number
  now?: () => Date
}

export type PrepareServiceBundle = (
  options: PrepareServiceBundleOptions
) => Promise<ServiceBundleSelection>

type PackageManifest = {
  name?: unknown
  version?: unknown
  engines?: { node?: unknown }
  bin?: unknown
}

export const getBundledServerVersion = () => {
  const manifest = JSON.parse(readFileSync(PACKAGE_MANIFEST_PATH, 'utf8')) as PackageManifest
  if (manifest.name !== SERVICE_PACKAGE_NAME || typeof manifest.version !== 'string') {
    throw new Error(`Invalid package manifest at ${PACKAGE_MANIFEST_PATH}.`)
  }
  return manifest.version
}

const sanitizeVersion = (version: string) => {
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error(`Refusing unsafe package version "${version}".`)
  }
  return version
}

const atomicWrite = (path: string, contents: string, mode?: number) => {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  writeFileSync(temporaryPath, contents, 'utf8')
  if (mode !== undefined) {
    chmodSync(temporaryPath, mode)
  }
  renameSync(temporaryPath, path)
}

export const getServiceBundlesDirectory = (metadataDirectory: string) =>
  join(metadataDirectory, 'bundles')

export const getServiceBundleDirectory = (metadataDirectory: string, version: string) =>
  join(getServiceBundlesDirectory(metadataDirectory), sanitizeVersion(version))

export const getServiceBundleSelectionPath = (metadataDirectory: string) =>
  join(metadataDirectory, 'active-bundle.json')

export const getPreviousServiceBundleSelectionPath = (metadataDirectory: string) =>
  join(metadataDirectory, 'previous-bundle.json')

export const getServiceBundleBootstrapPath = (metadataDirectory: string) =>
  join(metadataDirectory, 'launch-service.cjs')

export const writeJsonAtomic = (path: string, value: unknown) => {
  atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`)
}

export const writeTextAtomic = (path: string, contents: string, mode?: number) => {
  atomicWrite(path, contents, mode)
}

const normalizeSelection = (value: unknown): ServiceBundleSelection | null => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null
  }
  const record = value as Record<string, unknown>
  if (
    typeof record.version !== 'string'
    || typeof record.entrypoint !== 'string'
    || typeof record.nodePath !== 'string'
    || typeof record.activatedAt !== 'string'
  ) {
    return null
  }
  return record as ServiceBundleSelection
}

export const readServiceBundleSelection = (
  metadataDirectory: string,
  previous = false
): ServiceBundleSelection | null => {
  const path = previous
    ? getPreviousServiceBundleSelectionPath(metadataDirectory)
    : getServiceBundleSelectionPath(metadataDirectory)
  if (!existsSync(path)) {
    return null
  }
  try {
    return normalizeSelection(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

export const activateServiceBundleSelection = (
  metadataDirectory: string,
  selection: ServiceBundleSelection,
  previousSelection?: ServiceBundleSelection | null
) => {
  if (previousSelection) {
    writeJsonAtomic(getPreviousServiceBundleSelectionPath(metadataDirectory), previousSelection)
  }
  writeJsonAtomic(getServiceBundleSelectionPath(metadataDirectory), selection)
}

const parseVersion = (version: string) => version.split('.').slice(0, 3).map((part) => {
  const parsed = Number.parseInt(part, 10)
  return Number.isFinite(parsed) ? parsed : 0
})

const satisfiesNodeEngine = (engine: string, nodeVersion: string) => {
  const match = engine.trim().match(/^>=\s*(\d+\.\d+\.\d+)/u)
  if (!match) {
    return false
  }
  const required = parseVersion(match[1])
  const actual = parseVersion(nodeVersion.replace(/^v/u, ''))
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== required[index]) {
      return actual[index] > required[index]
    }
  }
  return true
}

const resolveManifestEntrypoint = (
  manifest: PackageManifest,
  packageDirectory: string,
  requestedVersion: string,
  nodeVersion: string
) => {
  if (manifest.name !== SERVICE_PACKAGE_NAME || manifest.version !== requestedVersion) {
    throw new Error(`Prepared bundle did not contain ${SERVICE_PACKAGE_NAME}@${requestedVersion}.`)
  }
  const engine = manifest.engines?.node
  if (typeof engine !== 'string' || !satisfiesNodeEngine(engine, nodeVersion)) {
    throw new Error(`Prepared bundle requires an unsupported Node engine (${String(engine)}).`)
  }
  const bin = manifest.bin
  const relativeEntrypoint = typeof bin === 'string'
    ? bin
    : typeof bin === 'object' && bin !== null
      ? (bin as Record<string, unknown>)['codori-server']
      : undefined
  if (typeof relativeEntrypoint !== 'string') {
    throw new Error('Prepared bundle does not declare the codori-server entrypoint.')
  }
  const entrypoint = resolve(packageDirectory, relativeEntrypoint)
  if (!entrypoint.startsWith(`${resolve(packageDirectory)}${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('Prepared bundle entrypoint escapes its package directory.')
  }
  if (!existsSync(entrypoint) || !statSync(entrypoint).isFile()) {
    throw new Error(`Prepared bundle entrypoint does not exist: ${entrypoint}`)
  }
  return entrypoint
}

const readNodeVersion = async (nodePath: string, timeoutMs: number) => await new Promise<string>((resolvePromise, reject) => {
  const child = spawn(nodePath, ['--version'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let stdout = ''
  let stderr = ''
  const timer = setTimeout(() => {
    child.kill()
    reject(new Error(`Timed out checking Node compatibility after ${timeoutMs}ms.`))
  }, timeoutMs)
  child.stdout.on('data', chunk => { stdout += chunk.toString() })
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  child.once('error', error => {
    clearTimeout(timer)
    reject(error)
  })
  child.once('close', code => {
    clearTimeout(timer)
    if (code !== 0) {
      reject(new Error(stderr.trim() || `Node version check exited with ${String(code)}.`))
      return
    }
    resolvePromise(stdout.trim())
  })
})

const installExactPackage = async (
  npmPath: string,
  stagingDirectory: string,
  version: string,
  timeoutMs: number
) => await new Promise<void>((resolvePromise, reject) => {
  const args = [
    'install',
    '--prefix', stagingDirectory,
    '--no-audit',
    '--no-fund',
    '--omit=dev',
    '--package-lock=false',
    '--save=false',
    '--exact',
    `${SERVICE_PACKAGE_NAME}@${version}`
  ]
  const child = spawn(npmPath, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    shell: process.platform === 'win32'
  })
  let stderr = ''
  const timer = setTimeout(() => {
    child.kill()
    reject(new Error(`Timed out preparing ${SERVICE_PACKAGE_NAME}@${version} after ${timeoutMs}ms.`))
  }, timeoutMs)
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  child.once('error', error => {
    clearTimeout(timer)
    reject(error)
  })
  child.once('close', code => {
    clearTimeout(timer)
    if (code !== 0) {
      reject(new Error(stderr.trim() || `npm install exited with ${String(code)}.`))
      return
    }
    resolvePromise()
  })
})

export const prepareServiceBundle: PrepareServiceBundle = async (options) => {
  const version = sanitizeVersion(options.version)
  const timeoutMs = options.timeoutMs ?? DEFAULT_BUNDLE_PREPARATION_TIMEOUT_MS
  const bundlesDirectory = getServiceBundlesDirectory(options.metadataDirectory)
  const finalDirectory = getServiceBundleDirectory(options.metadataDirectory, version)
  const packageDirectory = join(finalDirectory, 'node_modules', '@codori', 'server')
  const manifestPath = join(packageDirectory, 'package.json')
  const nodeVersion = await readNodeVersion(options.nodePath, timeoutMs)

  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
    return {
      version,
      entrypoint: resolveManifestEntrypoint(manifest, packageDirectory, version, nodeVersion),
      nodePath: options.nodePath,
      activatedAt: (options.now ?? (() => new Date()))().toISOString()
    }
  }

  mkdirSync(bundlesDirectory, { recursive: true })
  const stagingDirectory = join(bundlesDirectory, `.staging-${version}-${randomUUID()}`)
  mkdirSync(stagingDirectory, { recursive: true })
  try {
    await installExactPackage(options.npmPath, stagingDirectory, version, timeoutMs)
    const stagedPackageDirectory = join(stagingDirectory, 'node_modules', '@codori', 'server')
    const stagedManifest = JSON.parse(readFileSync(join(stagedPackageDirectory, 'package.json'), 'utf8')) as PackageManifest
    resolveManifestEntrypoint(stagedManifest, stagedPackageDirectory, version, nodeVersion)
    if (existsSync(finalDirectory)) {
      rmSync(finalDirectory, { recursive: true, force: true })
    }
    renameSync(stagingDirectory, finalDirectory)
    const finalManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PackageManifest
    return {
      version,
      entrypoint: resolveManifestEntrypoint(finalManifest, packageDirectory, version, nodeVersion),
      nodePath: options.nodePath,
      activatedAt: (options.now ?? (() => new Date()))().toISOString()
    }
  } catch (error) {
    rmSync(stagingDirectory, { recursive: true, force: true })
    throw error
  }
}

export const cleanupServiceBundles = (
  metadataDirectory: string,
  retainedVersions: string[]
) => {
  const bundlesDirectory = getServiceBundlesDirectory(metadataDirectory)
  if (!existsSync(bundlesDirectory)) {
    return
  }
  const retained = new Set(retainedVersions)
  for (const entry of readdirSync(bundlesDirectory, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    if (entry.name.startsWith('.staging-') || !retained.has(entry.name)) {
      rmSync(join(bundlesDirectory, entry.name), { recursive: true, force: true })
    }
  }
}

export const buildServiceBundleBootstrap = (selectionPath: string) => [
  "'use strict'",
  "const { readFileSync } = require('node:fs')",
  "const { spawn } = require('node:child_process')",
  `const selection = JSON.parse(readFileSync(${JSON.stringify(selectionPath)}, 'utf8'))`,
  "if (!selection || typeof selection.nodePath !== 'string' || typeof selection.entrypoint !== 'string') {",
  "  throw new Error('Codori service bundle selection is malformed.')",
  '}',
  "const child = spawn(selection.nodePath, [selection.entrypoint, ...process.argv.slice(2)], { stdio: 'inherit', env: process.env, windowsHide: true })",
  "for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))",
  "child.once('error', error => { console.error(error); process.exit(1) })",
  "child.once('exit', (code, signal) => {",
  "  if (signal) process.kill(process.pid, signal)",
  '  else process.exit(code ?? 1)',
  '})'
].join('\n')

export const ensureServiceBundleBootstrap = (metadataDirectory: string) => {
  const path = getServiceBundleBootstrapPath(metadataDirectory)
  atomicWrite(path, `${buildServiceBundleBootstrap(getServiceBundleSelectionPath(metadataDirectory))}\n`, 0o755)
  return path
}

export const describeBundleSelection = (selection: ServiceBundleSelection) =>
  `${selection.version} (${basename(selection.entrypoint)})`

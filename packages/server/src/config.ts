import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { CodoriError } from './errors.js'
import type { CodoriConfig, ConfigOverrides } from './types.js'

export const DEFAULT_SERVER_HOST = '127.0.0.1'
export const DEFAULT_SERVER_PORT = 4310
const DEFAULT_PORT_START = 46000
const DEFAULT_PORT_END = 46999

type PartialConfig = Partial<CodoriConfig> & {
  server?: Partial<CodoriConfig['server']>
  ports?: Partial<CodoriConfig['ports']>
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const resolveCodoriHome = (homeDir = os.homedir()) => join(homeDir, '.codori')

export const resolveCodoriConfigPath = (homeDir = os.homedir()) =>
  join(resolveCodoriHome(homeDir), 'config.json')

export const ensureCodoriDirectories = (homeDir = os.homedir()) => {
  const codoriHome = resolveCodoriHome(homeDir)
  mkdirSync(codoriHome, { recursive: true })
  mkdirSync(join(codoriHome, 'run'), { recursive: true })
  return {
    codoriHome,
    runDir: join(codoriHome, 'run')
  }
}

const loadUserConfig = (homeDir = os.homedir()): PartialConfig => {
  const configPath = resolveCodoriConfigPath(homeDir)
  if (!existsSync(configPath)) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'))
  } catch (error) {
    throw new CodoriError(
      'INVALID_CONFIG',
      `Failed to parse Codori config at ${configPath}.`,
      error
    )
  }

  if (!isRecord(parsed)) {
    throw new CodoriError('INVALID_CONFIG', `Codori config at ${configPath} must be a JSON object.`)
  }

  return parsed as PartialConfig
}

const ensureValidPort = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new CodoriError('INVALID_CONFIG', `${label} must be an integer between 1 and 65535.`)
  }

  return value
}

export const resolveConfig = (
  overrides: ConfigOverrides = {},
  homeDir = os.homedir()
): CodoriConfig => {
  const fileConfig = loadUserConfig(homeDir)
  const root = overrides.root ?? fileConfig.root

  if (!root || typeof root !== 'string') {
    throw new CodoriError('MISSING_ROOT', 'Project root is required. Pass --root or set ~/.codori/config.json.')
  }

  const host = overrides.host
    ?? (typeof fileConfig.server?.host === 'string' ? fileConfig.server.host : undefined)
    ?? DEFAULT_SERVER_HOST
  const port = overrides.port
    ?? (typeof fileConfig.server?.port === 'number' ? fileConfig.server.port : undefined)
    ?? DEFAULT_SERVER_PORT
  const portStart = typeof fileConfig.ports?.start === 'number'
    ? fileConfig.ports.start
    : DEFAULT_PORT_START
  const portEnd = typeof fileConfig.ports?.end === 'number'
    ? fileConfig.ports.end
    : DEFAULT_PORT_END

  const resolvedPort = ensureValidPort(port, 'server.port')
  const resolvedPortStart = ensureValidPort(portStart, 'ports.start')
  const resolvedPortEnd = ensureValidPort(portEnd, 'ports.end')

  if (resolvedPortStart > resolvedPortEnd) {
    throw new CodoriError('INVALID_CONFIG', 'ports.start must be less than or equal to ports.end.')
  }

  ensureCodoriDirectories(homeDir)

  return {
    root: resolve(root),
    server: {
      host,
      port: resolvedPort
    },
    ports: {
      start: resolvedPortStart,
      end: resolvedPortEnd
    }
  }
}

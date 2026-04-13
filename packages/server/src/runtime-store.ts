import { createHash } from 'node:crypto'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { join, resolve } from 'node:path'
import { ensureCodoriDirectories, resolveCodoriHome } from './config.js'
import type { RuntimeRecord } from './types.js'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const normalizeRuntimeRecord = (value: unknown): RuntimeRecord | null => {
  if (!isRecord(value)) {
    return null
  }

  const { projectId, projectPath, pid, port, startedAt, lastActivityAt } = value
  if (
    typeof projectId !== 'string'
    || typeof projectPath !== 'string'
    || typeof pid !== 'number'
    || !Number.isInteger(pid)
    || typeof port !== 'number'
    || !Number.isInteger(port)
    || typeof startedAt !== 'number'
    || (lastActivityAt !== undefined && typeof lastActivityAt !== 'number')
  ) {
    return null
  }

  return {
    projectId,
    projectPath,
    pid,
    port,
    startedAt,
    lastActivityAt: typeof lastActivityAt === 'number' ? lastActivityAt : startedAt
  }
}

export type RuntimeLoadResult
  = { kind: 'missing', path: string }
  | { kind: 'invalid', path: string, error: string }
  | { kind: 'valid', path: string, record: RuntimeRecord }

export class RuntimeStore {
  readonly runDir: string

  constructor(homeDir = os.homedir()) {
    ensureCodoriDirectories(homeDir)
    this.runDir = join(resolveCodoriHome(homeDir), 'run')
  }

  resolveRuntimePath(projectPath: string) {
    const normalizedProjectPath = resolve(projectPath)
    const digest = createHash('sha256').update(normalizedProjectPath).digest('hex').slice(0, 16)
    return join(this.runDir, `${digest}.pid.json`)
  }

  load(projectPath: string): RuntimeLoadResult {
    const runtimePath = this.resolveRuntimePath(projectPath)
    if (!existsSync(runtimePath)) {
      return {
        kind: 'missing',
        path: runtimePath
      }
    }

    try {
      const parsed: unknown = JSON.parse(readFileSync(runtimePath, 'utf8'))
      const record = normalizeRuntimeRecord(parsed)
      if (!record) {
        return {
          kind: 'invalid',
          path: runtimePath,
          error: 'Runtime metadata is malformed.'
        }
      }

      return {
        kind: 'valid',
        path: runtimePath,
        record
      }
    } catch (error) {
      return {
        kind: 'invalid',
        path: runtimePath,
        error: error instanceof Error ? error.message : String(error)
      }
    }
  }

  write(record: RuntimeRecord) {
    const runtimePath = this.resolveRuntimePath(record.projectPath)
    writeFileSync(runtimePath, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  }

  remove(projectPath: string) {
    rmSync(this.resolveRuntimePath(projectPath), { force: true })
  }
}

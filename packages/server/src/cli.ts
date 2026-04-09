#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { asErrorMessage, CodoriError } from './errors.js'
import { startHttpServer } from './http-server.js'
import { createRuntimeManager } from './process-manager.js'
import type { ProjectStatusRecord, StartProjectResult } from './types.js'

const printJson = (value: unknown) => {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const printStatuses = (records: ProjectStatusRecord[]) => {
  for (const record of records) {
    const runtimeDetails = [
      record.status,
      record.port ? `port=${record.port}` : null,
      record.pid ? `pid=${record.pid}` : null
    ].filter(Boolean).join(' ')

    process.stdout.write(`${record.projectId}\t${runtimeDetails}\n`)
    if (record.error) {
      process.stdout.write(`  error: ${record.error}\n`)
    }
  }
}

const printStartResult = (result: StartProjectResult) => {
  const action = result.reusedExisting ? 'reused' : 'started'
  process.stdout.write(`${result.projectId}\t${action}\tport=${result.port}\tpid=${result.pid}\n`)
}

const optionConfig = {
  root: {
    type: 'string' as const
  },
  host: {
    type: 'string' as const
  },
  port: {
    type: 'string' as const
  },
  json: {
    type: 'boolean' as const
  }
}

const coercePort = (value: string | undefined) => {
  if (!value) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const main = async () => {
  const parsed = parseArgs({
    allowPositionals: true,
    options: optionConfig
  })

  const [command, maybeProjectId] = parsed.positionals
  const manager = createRuntimeManager({
    configOverrides: {
      root: parsed.values.root,
      host: parsed.values.host,
      port: coercePort(parsed.values.port)
    }
  })
  const json = parsed.values.json ?? false

  switch (command) {
    case 'list': {
      const statuses = manager.listProjectStatuses()
      if (json) {
        printJson(statuses)
      } else {
        printStatuses(statuses)
      }
      return
    }
    case 'status': {
      if (maybeProjectId) {
        const status = manager.getProjectStatus(maybeProjectId)
        if (json) {
          printJson(status)
        } else {
          printStatuses([status])
        }
        return
      }

      const statuses = manager.listProjectStatuses()
      if (json) {
        printJson(statuses)
      } else {
        printStatuses(statuses)
      }
      return
    }
    case 'start': {
      if (!maybeProjectId) {
        throw new CodoriError('MISSING_PROJECT_ID', 'The start command requires a project id.')
      }
      const result = await manager.startProject(maybeProjectId)
      if (json) {
        printJson(result)
      } else {
        printStartResult(result)
      }
      return
    }
    case 'stop': {
      if (!maybeProjectId) {
        throw new CodoriError('MISSING_PROJECT_ID', 'The stop command requires a project id.')
      }
      const result = await manager.stopProject(maybeProjectId)
      if (json) {
        printJson(result)
      } else {
        printStatuses([result])
      }
      return
    }
    case 'serve': {
      const app = await startHttpServer(manager)
      process.stdout.write(`Codori listening on http://${manager.config.server.host}:${manager.config.server.port}\n`)
      await app.ready()
      return
    }
    default:
      process.stdout.write('Usage: codori <serve|list|status|start|stop> [projectId] [--root <path>] [--json]\n')
  }
}

void main().catch((error) => {
  if (error instanceof CodoriError) {
    process.stderr.write(`${error.code}: ${error.message}\n`)
  } else {
    process.stderr.write(`${asErrorMessage(error)}\n`)
  }
  process.exitCode = 1
})

#!/usr/bin/env node
import { resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { asErrorMessage, CodoriError } from './errors.js'
import { startHttpServer } from './http-server.js'
import { createRuntimeManager } from './process-manager.js'
import {
  installService,
  restartService,
  uninstallService,
  type ServiceCommandDependencies
} from './service.js'
import type { ProjectStatusRecord, StartProjectResult } from './types.js'

type CliOptionValues = {
  root?: string
  host?: string
  port?: string
  json?: boolean
  scope?: string
  yes?: boolean
  help?: boolean
}

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
  },
  scope: {
    type: 'string' as const
  },
  yes: {
    type: 'boolean' as const
  },
  help: {
    type: 'boolean' as const,
    short: 'h'
  }
}

const coercePort = (value: string | undefined) => {
  if (!value) {
    return undefined
  }
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

const resolveCliRoot = (value: string | undefined) => value ?? process.cwd()

export const CLI_USAGE = [
  'Usage:',
  '  npx @codori/server <command> [projectId] [options]',
  '  codori <command> [projectId] [options]',
  '',
  'Runtime commands:',
  '  serve',
  '  list',
  '  status [projectId]',
  '  start <projectId>',
  '  stop <projectId>',
  '',
  'Service commands:',
  '  install-service',
  '  setup-service',
  '  restart-service',
  '  uninstall-service',
  '',
  'Options:',
  '  --root <path>',
  '  --host <host>',
  '  --port <port>',
  '  --scope <user|system>',
  '  --yes',
  '  --json',
  '  --help',
  '',
  'Canonical service examples:',
  '  npx @codori/server install-service',
  '  npx @codori/server restart-service --root ~/Project/codori',
  '  npx @codori/server uninstall-service --root ~/Project/codori',
  '',
  'Installed binary examples:',
  '  codori install-service',
  '  codori restart-service --root ~/Project/codori'
].join('\n')

const printUsage = (stdout: NodeJS.WritableStream = process.stdout) => {
  stdout.write(`${CLI_USAGE}\n`)
}

const executeServiceCommand = async (
  command: 'install-service' | 'setup-service' | 'restart-service' | 'uninstall-service',
  values: CliOptionValues,
  dependencies: ServiceCommandDependencies = {}
) => {
  const stdout = dependencies.stdout ?? process.stdout
  const options = {
    root: values.root,
    host: values.host,
    port: values.port,
    scope: values.scope,
    yes: values.yes ?? false
  }

  switch (command) {
    case 'install-service':
    case 'setup-service': {
      const result = await installService(options, dependencies)
      stdout.write(`Installed service ${result.metadata.serviceName}\n`)
      return
    }
    case 'restart-service': {
      const result = await restartService({
        root: values.root,
        scope: values.scope,
        yes: values.yes ?? false
      }, dependencies)
      stdout.write(`Restarted service ${result.metadata.serviceName}\n`)
      return
    }
    case 'uninstall-service': {
      const result = await uninstallService({
        root: values.root,
        yes: values.yes ?? false
      }, dependencies)
      stdout.write(`Removed service ${result.metadata.serviceName}\n`)
    }
  }
}

export const runCli = async (
  argv: string[] = process.argv.slice(2),
  dependencies: ServiceCommandDependencies = {}
) => {
  const parsed = parseArgs({
    args: argv,
    allowPositionals: true,
    options: optionConfig
  })

  const values = parsed.values as CliOptionValues
  const [command = 'serve', maybeProjectId] = parsed.positionals
  if (values.help) {
    printUsage(dependencies.stdout ?? process.stdout)
    return
  }

  if (
    command === 'install-service'
    || command === 'setup-service'
    || command === 'restart-service'
    || command === 'uninstall-service'
  ) {
    await executeServiceCommand(command, values, dependencies)
    return
  }

  switch (command) {
    case 'list': {
      const manager = createRuntimeManager({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port)
        }
      })
      const json = values.json ?? false
      const statuses = manager.listProjectStatuses()
      if (json) {
        printJson(statuses)
      } else {
        printStatuses(statuses)
      }
      return
    }
    case 'status': {
      const manager = createRuntimeManager({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port)
        }
      })
      const json = values.json ?? false
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
      const manager = createRuntimeManager({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port)
        }
      })
      const json = values.json ?? false
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
      const manager = createRuntimeManager({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port)
        }
      })
      const json = values.json ?? false
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
      const manager = createRuntimeManager({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port)
        }
      })
      const app = await startHttpServer(manager)
      process.stdout.write(`Running codori server with project root directory: ${manager.config.root}\n`)
      process.stdout.write(`Codori listening on http://${manager.config.server.host}:${manager.config.server.port}\n`)
      process.stdout.write('Private tunnel is not included. Expose Codori through your own network layer such as Tailscale or Cloudflare Tunnel when you need remote access.\n')
      await app.ready()
      return
    }
    default:
      printUsage(dependencies.stdout ?? process.stdout)
  }
}

const isEntrypoint = process.argv[1]
  ? resolvePath(process.argv[1]) === fileURLToPath(import.meta.url)
  : false

if (isEntrypoint) {
  void runCli().catch((error) => {
    if (error instanceof CodoriError) {
      process.stderr.write(`${error.code}: ${error.message}\n`)
    } else {
      process.stderr.write(`${asErrorMessage(error)}\n`)
    }
    process.exitCode = 1
  })
}

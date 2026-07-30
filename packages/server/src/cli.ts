#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { asErrorMessage, CodoriError } from './errors.js'
import { startHttpServer } from './http-server.js'
import { createRuntimeManager } from './process-manager.js'
import { DEFAULT_SERVER_HOST } from './config.js'
import {
  installService,
  restartService,
  uninstallService,
  type ServiceCommandDependencies
} from './service.js'
import {
  configureTailscaleServe,
  type TailscaleServeResult
} from './tailscale-serve.js'
import type { ProjectStatusRecord, StartProjectResult } from './types.js'

type CliOptionValues = {
  root?: string
  host?: string
  port?: string
  json?: boolean
  scope?: string
  yes?: boolean
  help?: boolean
  'experimental-realtime-voice'?: boolean
  'tailscale-serve'?: boolean
}

export type CliDependencies = ServiceCommandDependencies & {
  createRuntimeManager?: typeof createRuntimeManager
  startHttpServer?: typeof startHttpServer
  configureTailscaleServe?: (
    port: number,
    runCommand?: ServiceCommandDependencies['runCommand']
  ) => Promise<TailscaleServeResult>
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
  'experimental-realtime-voice': {
    type: 'boolean' as const
  },
  'tailscale-serve': {
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
  '  --experimental-realtime-voice',
  '  --tailscale-serve',
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

export const resolveCliEntrypointPath = (value: string | undefined) => {
  if (!value) {
    return null
  }

  const resolved = resolvePath(value)
  try {
    return realpathSync(resolved)
  } catch {
    return resolved
  }
}

export const isCliEntrypointPath = (argvPath: string | undefined, moduleUrl: string) => {
  const entryPath = resolveCliEntrypointPath(argvPath)
  const modulePath = resolveCliEntrypointPath(fileURLToPath(moduleUrl))
  return entryPath !== null && entryPath === modulePath
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
  dependencies: CliDependencies = {}
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
    if (values['tailscale-serve']) {
      throw new CodoriError(
        'INVALID_CONFIG',
        '--tailscale-serve is available only for a direct `serve` launch.'
      )
    }
    if (values['experimental-realtime-voice']) {
      throw new CodoriError(
        'INVALID_CONFIG',
        'Installed services configure experimental realtime voice with realtimeVoice.enabled in ~/.codori/config.json. It is enabled by default.'
      )
    }
    await executeServiceCommand(command, values, dependencies)
    return
  }

  switch (command) {
    case 'list': {
      if (values['tailscale-serve']) {
        throw new CodoriError('INVALID_CONFIG', '--tailscale-serve is available only for the serve command.')
      }
      const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
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
      if (values['tailscale-serve']) {
        throw new CodoriError('INVALID_CONFIG', '--tailscale-serve is available only for the serve command.')
      }
      const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
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
      if (values['tailscale-serve']) {
        throw new CodoriError('INVALID_CONFIG', '--tailscale-serve is available only for the serve command.')
      }
      const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
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
      if (values['tailscale-serve']) {
        throw new CodoriError('INVALID_CONFIG', '--tailscale-serve is available only for the serve command.')
      }
      const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
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
      const tailscaleServe = values['tailscale-serve'] ?? false
      if (tailscaleServe && values.host && values.host !== DEFAULT_SERVER_HOST) {
        throw new CodoriError(
          'INVALID_CONFIG',
          `--tailscale-serve requires --host ${DEFAULT_SERVER_HOST}; remove the conflicting --host value.`
        )
      }

      const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: tailscaleServe ? DEFAULT_SERVER_HOST : values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
        }
      })
      const app = await (dependencies.startHttpServer ?? startHttpServer)(manager)
      const stdout = dependencies.stdout ?? process.stdout

      let serveResult: TailscaleServeResult | null = null
      if (tailscaleServe) {
        try {
          serveResult = await (
            dependencies.configureTailscaleServe
            ?? configureTailscaleServe
          )(manager.config.server.port, dependencies.runCommand)
        } catch (error) {
          await Promise.resolve(app.close()).catch(() => {})
          throw error
        }
      }

      stdout.write(`Running codori server with project root directory: ${manager.config.root}\n`)
      stdout.write(`Codori listening on http://${manager.config.server.host}:${manager.config.server.port}\n`)
      if (serveResult) {
        const action = serveResult.alreadyConfigured ? 'reusing' : 'configured'
        stdout.write(`Tailscale Serve ${action}: ${serveResult.url}\n`)
      } else {
        stdout.write('Private HTTPS is not enabled. Re-run with --tailscale-serve to configure private Tailscale Serve access.\n')
      }
      await app.ready()
      return
    }
    default:
      printUsage(dependencies.stdout ?? process.stdout)
  }
}

const isEntrypoint = isCliEntrypointPath(process.argv[1], import.meta.url)

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

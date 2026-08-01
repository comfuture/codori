#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { asErrorMessage, CodoriError } from './errors.js'
import { startHttpServer } from './http-server.js'
import { createRuntimeManager } from './process-manager.js'
import { DEFAULT_SERVER_HOST, resolveLastServiceRoot, writeLastServiceRoot } from './config.js'
import {
  installService,
  restartService,
  startService,
  statusService,
  stopService,
  uninstallService,
  type ServiceCommandDependencies
} from './service.js'
import {
  configureTailscaleServe,
  type TailscaleServeResult
} from './tailscale-serve.js'
import {
  checkStartupUpdate,
  CODORI_STARTUP_UPDATE_APPLIED_ENV,
  type StartupUpdateResult
} from './service-update.js'
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
  checkStartupUpdate?: typeof checkStartupUpdate
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

export const resolveServeRoot = (
  value: string | undefined,
  options: {
    env?: NodeJS.ProcessEnv
    homeDir?: string
    cwd?: string
    lastRoot?: (homeDir?: string) => string | null
  } = {}
) => {
  if (value) {
    return value
  }

  const env = options.env ?? process.env
  // Only a managed service adopts the remembered root; a manual `serve` in a
  // directory should keep behaving like the current working directory.
  if (env.CODORI_SERVICE_MANAGED === '1') {
    const lastRoot = (options.lastRoot ?? resolveLastServiceRoot)(options.homeDir)
    if (lastRoot) {
      return lastRoot
    }
  }

  return options.cwd ?? process.cwd()
}

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
  '  service install',
  '  service start',
  '  service stop',
  '  service restart',
  '  service status',
  '  service uninstall',
  '',
  'Service command aliases (deprecated):',
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
  '  npx @codori/server service install',
  '  npx @codori/server service start --root ~/Project/codori',
  '  npx @codori/server service stop --root ~/Project/codori',
  '  npx @codori/server service uninstall --root ~/Project/codori',
  '',
  'Installed binary examples:',
  '  codori service install',
  '  codori service start',
  '  codori service stop',
  '  codori service uninstall'
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

const LEGACY_SERVICE_COMMANDS = new Set([
  'install-service',
  'setup-service',
  'restart-service',
  'uninstall-service'
])

const SERVICE_SUBCOMMANDS = new Set([
  'install',
  'setup',
  'start',
  'stop',
  'restart',
  'status',
  'uninstall'
])

export type ServiceCliAction
  = 'install'
  | 'start'
  | 'stop'
  | 'restart'
  | 'status'
  | 'uninstall'

export const resolveServiceCliAction = (
  command: string,
  subcommand: string | undefined
): ServiceCliAction | null => {
  if (command === 'service') {
    if (!subcommand) {
      throw new CodoriError(
        'MISSING_SERVICE_SUBCOMMAND',
        'The service command requires one of install, start, stop, restart, status, or uninstall.'
      )
    }

    if (!SERVICE_SUBCOMMANDS.has(subcommand)) {
      throw new CodoriError(
        'UNKNOWN_SERVICE_SUBCOMMAND',
        `Unknown service subcommand "${subcommand}". Expected install, start, stop, restart, status, or uninstall.`
      )
    }

    return subcommand === 'setup' ? 'install' : subcommand as ServiceCliAction
  }

  if (!LEGACY_SERVICE_COMMANDS.has(command)) {
    return null
  }

  if (command === 'install-service' || command === 'setup-service') {
    return 'install'
  }
  if (command === 'restart-service') {
    return 'restart'
  }
  return 'uninstall'
}

/**
 * Replaces this launch with the newer published bundle by running it through
 * npx and forwarding the original argv. The current process exits with the
 * child's code, so the OS service manager keeps supervising one process.
 */
const execAdoptedPackage = (argv: string[]) => async (specifier: string) => {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', specifier, 'serve', ...argv],
      {
        env: {
          ...process.env,
          [CODORI_STARTUP_UPDATE_APPLIED_ENV]: '1'
        },
        stdio: 'inherit',
        windowsHide: true
      }
    )

    child.once('error', reject)
    child.once('exit', (code) => {
      process.exitCode = code ?? 0
      resolvePromise()
    })
  })
}

const describeStartupUpdate = (result: StartupUpdateResult) => {
  if (!result.checked) {
    return null
  }

  if (result.adopted) {
    return `Adopted @codori/server ${result.latestVersion} for this launch (was ${result.installedVersion}).`
  }

  if (result.reason === 'registry-unavailable') {
    return 'Could not reach the npm registry to check for a newer @codori/server bundle.'
  }

  if (result.updateAvailable) {
    return `@codori/server ${result.latestVersion} is available but could not be adopted automatically.`
  }

  return null
}

const executeServiceCommand = async (
  action: ServiceCliAction,
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

  switch (action) {
    case 'install': {
      const result = await installService(options, dependencies)
      stdout.write(`Installed service ${result.metadata.serviceName}\n`)
      return
    }
    case 'restart': {
      const result = await restartService({
        root: values.root,
        scope: values.scope,
        yes: values.yes ?? false
      }, dependencies)
      stdout.write(`Restarted service ${result.metadata.serviceName}\n`)
      return
    }
    case 'start': {
      const result = await startService({
        root: values.root,
        scope: values.scope,
        yes: values.yes ?? false
      }, dependencies)
      stdout.write(`Started service ${result.metadata.serviceName}\n`)
      return
    }
    case 'stop': {
      const result = await stopService({
        root: values.root,
        scope: values.scope,
        yes: values.yes ?? false
      }, dependencies)
      stdout.write(`Stopped service ${result.metadata.serviceName}\n`)
      return
    }
    case 'status': {
      const result = await statusService({
        root: values.root,
        scope: values.scope,
        yes: values.yes ?? false
      }, dependencies)
      stdout.write(`${result.metadata.serviceName}\n${result.status ?? ''}\n`)
      return
    }
    case 'uninstall': {
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

  const serviceAction = resolveServiceCliAction(command, maybeProjectId)
  if (serviceAction) {
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
    await executeServiceCommand(serviceAction, values, dependencies)
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
          root: resolveServeRoot(values.root, {
            homeDir: dependencies.homeDir,
            cwd: dependencies.cwd
          }),
          host: tailscaleServe ? DEFAULT_SERVER_HOST : values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
        }
      })
      const stdoutStream = dependencies.stdout ?? process.stdout

      // A registered service checks npm before binding so a restarted service
      // picks up a newer published bundle for this launch.
      const startupUpdate = await (dependencies.checkStartupUpdate ?? checkStartupUpdate)({
        execPackage: execAdoptedPackage(argv.filter(entry => entry !== 'serve'))
      })
      const startupUpdateMessage = describeStartupUpdate(startupUpdate)
      if (startupUpdateMessage) {
        stdoutStream.write(`${startupUpdateMessage}\n`)
      }

      // The adopted bundle served this launch, so this process is done.
      if (startupUpdate.adopted) {
        return
      }

      const app = await (dependencies.startHttpServer ?? startHttpServer)(manager)
      const stdout = stdoutStream

      writeLastServiceRoot(manager.config.root, dependencies.homeDir)

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

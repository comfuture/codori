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
import { createCliUi, type CliUi } from './cli-ui.js'
import {
  CLI_BINARY,
  renderCliHelp
} from './cli-help.js'
import {
  installService,
  restartService,
  startService,
  statusService,
  stopService,
  uninstallService,
  CODORI_SERVICE_HOME_ENV,
  CODORI_SERVICE_INSTALL_ROOT_ENV,
  type ServiceCommandDependencies
} from './service.js'
import {
  configureTailscaleServe,
  detectTailscaleServeEligibility,
  type TailscaleServeEligibility,
  type TailscaleServePolicy,
  type TailscaleServeResult
} from './tailscale-serve.js'
import {
  checkStartupUpdate,
  CODORI_STARTUP_UPDATE_APPLIED_ENV,
  type StartupUpdateResult
} from './service-update.js'
import type { ProjectStatusRecord } from './types.js'

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
  'no-tailscale-serve'?: boolean
}

export type CliDependencies = ServiceCommandDependencies & {
  createRuntimeManager?: typeof createRuntimeManager
  startHttpServer?: typeof startHttpServer
  configureTailscaleServe?: (
    port: number,
    runCommand?: ServiceCommandDependencies['runCommand']
  ) => Promise<TailscaleServeResult>
  detectTailscaleServeEligibility?: (
    runCommand?: ServiceCommandDependencies['runCommand']
  ) => Promise<TailscaleServeEligibility>
  checkStartupUpdate?: typeof checkStartupUpdate
}

/**
 * JSON output bypasses the presentation layer entirely so a piped consumer
 * receives exactly one parseable document with no ANSI or spinner bytes.
 */
const printJson = (value: unknown, stdout: NodeJS.WritableStream) => {
  stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

const printStatuses = (records: ProjectStatusRecord[], ui: CliUi) => {
  if (records.length === 0) {
    ui.info('No project workspace runtimes are currently tracked.')
    ui.muted(`  Run \`${CLI_BINARY} list\` to see discovered projects, or start one with \`${CLI_BINARY} start <projectId>\`.`)
    return
  }

  ui.table(
    ['project', 'status', 'port', 'pid'],
    records.map(record => [
      ui.bold(record.projectId),
      ui.statusLabel(record.status),
      record.port ? String(record.port) : ui.dim('-'),
      record.pid ? String(record.pid) : ui.dim('-')
    ])
  )

  for (const record of records) {
    if (record.error) {
      ui.warn(`${record.projectId}: ${record.error}`)
    }
  }
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
  'no-tailscale-serve': {
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
  // A system-scoped service can run as a different account than the installer.
  const homeDir = options.homeDir ?? env[CODORI_SERVICE_HOME_ENV]?.trim()
  // Only a managed service adopts the remembered root; a manual `serve` in a
  // directory should keep behaving like the current working directory. The
  // remembered root wins over the install-time root so a Settings change
  // survives a restart.
  if (env.CODORI_SERVICE_MANAGED === '1') {
    const lastRoot = (options.lastRoot ?? resolveLastServiceRoot)(homeDir)
    if (lastRoot) {
      return lastRoot
    }

    const installRoot = env[CODORI_SERVICE_INSTALL_ROOT_ENV]?.trim()
    if (installRoot) {
      return installRoot
    }
  }

  return options.cwd ?? process.cwd()
}

/**
 * Plain-text rendering of the help body.
 *
 * This is produced by running the same renderer used for terminal output
 * against a plain, buffered stream, so the styled and unstyled forms can never
 * drift apart. It stays exported as a stable, styling-free surface for tests and
 * for callers that want the help text as a string.
 */
export const renderCliUsageText = () => {
  const lines: string[] = []
  const buffer: NodeJS.WritableStream = {
    write: (chunk: string) => {
      lines.push(chunk)
      return true
    }
  } as unknown as NodeJS.WritableStream

  renderCliHelp(createCliUi({ stream: buffer, env: {}, plain: true }))
  return lines.join('').trimEnd()
}

export const CLI_USAGE = renderCliUsageText()

const printUsage = (ui: CliUi) => {
  renderCliHelp(ui)
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
 *
 * `npx --yes @codori/server start` keeps resolving even though this package's
 * bin is named `codori-server`: npx runs a package's only bin regardless of
 * name. The `codori` bin belongs to the separate `codori` launcher package so
 * a global install of both cannot collide.
 */
const execAdoptedPackage = (argv: string[]) => async (specifier: string) => {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      process.platform === 'win32' ? 'npx.cmd' : 'npx',
      ['--yes', specifier, 'start', ...argv],
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
      // A nonzero exit means the newer bundle did not serve. Rejecting lets the
      // caller fall back to the installed bundle instead of reporting a
      // successful adoption and leaving the supervisor with nothing serving.
      if (code !== 0) {
        reject(new Error(`Adopted @codori/server exited with code ${code ?? 'null'}.`))
        return
      }

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

export const resolveTailscaleServePolicy = (
  values: Pick<CliOptionValues, 'host' | 'tailscale-serve' | 'no-tailscale-serve'>
): TailscaleServePolicy => {
  if (values['tailscale-serve'] && values['no-tailscale-serve']) {
    throw new CodoriError(
      'INVALID_CONFIG',
      '--tailscale-serve and --no-tailscale-serve cannot be used together.'
    )
  }

  if (values['tailscale-serve']) {
    if (values.host && values.host !== DEFAULT_SERVER_HOST) {
      throw new CodoriError(
        'INVALID_CONFIG',
        `--tailscale-serve requires --host ${DEFAULT_SERVER_HOST}; remove the conflicting --host value.`
      )
    }
    return 'required'
  }

  if (values['no-tailscale-serve'] || (values.host && values.host !== DEFAULT_SERVER_HOST)) {
    return 'disabled'
  }

  return 'auto'
}

const describeTailscaleEligibility = (eligibility: TailscaleServeEligibility) => {
  if (eligibility.reason === 'not-running') {
    return 'the Tailscale backend is not running'
  }
  if (eligibility.reason === 'magicdns-unavailable') {
    return 'this node does not report a usable MagicDNS name'
  }
  return 'Tailscale is unavailable'
}

const configureServiceTailscaleAccess = async (
  metadata: { port: number, host: string, tailscaleServePolicy: TailscaleServePolicy },
  dependencies: CliDependencies,
  ui: CliUi
) => {
  if (metadata.tailscaleServePolicy === 'disabled' || metadata.host !== DEFAULT_SERVER_HOST) {
    return
  }

  if (metadata.tailscaleServePolicy === 'auto') {
    const eligibility = await (
      dependencies.detectTailscaleServeEligibility
      ?? detectTailscaleServeEligibility
    )(dependencies.runCommand)
    if (!eligibility.eligible) {
      ui.muted(`  Tailscale Serve was not configured automatically: ${describeTailscaleEligibility(eligibility)}.`)
      return
    }
  }

  try {
    const result = await (
      dependencies.configureTailscaleServe
      ?? configureTailscaleServe
    )(metadata.port, dependencies.runCommand)
    const action = result.alreadyConfigured ? 'reusing' : 'configured'
    ui.success(`Tailscale Serve ${action}: ${ui.url(result.url)}`)
  } catch (error) {
    if (metadata.tailscaleServePolicy === 'required') {
      throw error
    }
    ui.warn(`Tailscale Serve was not configured automatically: ${asErrorMessage(error)}`)
  }
}

const executeServiceCommand = async (
  action: ServiceCliAction,
  values: CliOptionValues,
  dependencies: CliDependencies = {},
  ui: CliUi
) => {
  const stdout = dependencies.stdout ?? process.stdout
  const policy = resolveTailscaleServePolicy(values)
  const policyOverride = action === 'install'
    || values.host !== undefined
    || values['tailscale-serve']
    || values['no-tailscale-serve']
    ? policy
    : undefined
  const options = {
    root: values.root,
    host: values.host,
    port: values.port,
    scope: values.scope,
    yes: values.yes ?? false,
    tailscaleServePolicy: policyOverride
  }

  switch (action) {
    case 'install': {
      const result = await installService(options, dependencies)
      ui.success(`Installed service ${ui.bold(result.metadata.serviceName)}`)
      await configureServiceTailscaleAccess(result.metadata, dependencies, ui)
      ui.muted(`  Manage it with \`${CLI_BINARY} service status\` or \`${CLI_BINARY} service stop\`.`)
      return
    }
    case 'restart': {
      const result = await restartService({
        root: values.root,
        host: values.host,
        scope: values.scope,
        yes: values.yes ?? false,
        tailscaleServePolicy: options.tailscaleServePolicy
      }, dependencies)
      ui.success(`Restarted service ${ui.bold(result.metadata.serviceName)}`)
      await configureServiceTailscaleAccess(result.metadata, dependencies, ui)
      return
    }
    case 'start': {
      const result = await startService({
        root: values.root,
        host: values.host,
        scope: values.scope,
        yes: values.yes ?? false,
        tailscaleServePolicy: options.tailscaleServePolicy
      }, dependencies)
      ui.success(`Started service ${ui.bold(result.metadata.serviceName)}`)
      await configureServiceTailscaleAccess(result.metadata, dependencies, ui)
      return
    }
    case 'stop': {
      const result = await stopService({
        root: values.root,
        scope: values.scope,
        yes: values.yes ?? false
      }, dependencies)
      ui.success(`Stopped service ${ui.bold(result.metadata.serviceName)}`)
      return
    }
    case 'status': {
      const result = await statusService({
        root: values.root,
        scope: values.scope,
        yes: values.yes ?? false
      }, dependencies)
      ui.heading(result.metadata.serviceName)
      const status = result.status?.trim()
      if (status) {
        stdout.write(`${status}\n`)
      } else {
        ui.muted('  No status detail was reported by the platform service manager.')
      }
      return
    }
    case 'uninstall': {
      const result = await uninstallService({
        root: values.root,
        yes: values.yes ?? false
      }, dependencies)
      ui.success(`Removed service ${ui.bold(result.metadata.serviceName)}`)
    }
  }
}

const runServerCommand = async (
  command: 'start' | 'serve',
  argv: string[],
  values: CliOptionValues,
  dependencies: CliDependencies,
  ui: CliUi
) => {
  const policy = resolveTailscaleServePolicy(values)
  let eligibility: TailscaleServeEligibility | null = null
  let shouldConfigureTailscale = policy === 'required'

  if (command === 'serve' && (dependencies.env ?? process.env).CODORI_SERVICE_MANAGED !== '1') {
    ui.warn('`codori serve` is deprecated and will be removed in a future release; use `codori start`.')
  }

  if (policy === 'auto') {
    eligibility = await (
      dependencies.detectTailscaleServeEligibility
      ?? detectTailscaleServeEligibility
    )(dependencies.runCommand)
    shouldConfigureTailscale = eligibility.eligible
  }

  const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
    configOverrides: {
      root: resolveServeRoot(values.root, {
        homeDir: dependencies.homeDir,
        cwd: dependencies.cwd,
        env: dependencies.env
      }),
      host: shouldConfigureTailscale ? DEFAULT_SERVER_HOST : values.host,
      port: coercePort(values.port),
      realtimeVoiceEnabled: values['experimental-realtime-voice']
    }
  })

  // A registered service checks npm before binding so a restarted service
  // picks up a newer published bundle for this launch.
  const forwardedArgv = [...argv]
  const commandIndex = forwardedArgv.indexOf(command)
  if (commandIndex >= 0) {
    forwardedArgv.splice(commandIndex, 1)
  }
  const startupUpdate = await (dependencies.checkStartupUpdate ?? checkStartupUpdate)({
    execPackage: execAdoptedPackage(forwardedArgv)
  })
  const startupUpdateMessage = describeStartupUpdate(startupUpdate)
  if (startupUpdateMessage) {
    ui.info(startupUpdateMessage)
  }

  // The adopted bundle served this launch, so this process is done.
  if (startupUpdate.adopted) {
    return
  }

  const app = await (dependencies.startHttpServer ?? startHttpServer)(manager)

  writeLastServiceRoot(
    manager.config.root,
    dependencies.homeDir
    ?? (dependencies.env ?? process.env)[CODORI_SERVICE_HOME_ENV]?.trim()
  )

  let serveResult: TailscaleServeResult | null = null
  let automaticServeError: string | null = null
  if (shouldConfigureTailscale) {
    try {
      serveResult = await (
        dependencies.configureTailscaleServe
        ?? configureTailscaleServe
      )(manager.config.server.port, dependencies.runCommand)
    } catch (error) {
      if (policy === 'required') {
        await Promise.resolve(app.close()).catch(() => {})
        throw error
      }
      automaticServeError = asErrorMessage(error)
    }
  }

  const localUrl = `http://${manager.config.server.host}:${manager.config.server.port}`
  ui.success(`Codori listening on ${ui.url(localUrl)}`)
  if (serveResult) {
    const action = serveResult.alreadyConfigured ? 'reusing' : 'configured'
    ui.success(`Tailscale Serve ${action}: ${ui.url(serveResult.url)}`)
  } else if (automaticServeError) {
    ui.warn(`Tailscale Serve was not configured automatically: ${automaticServeError}`)
  } else if (policy === 'auto' && eligibility && !eligibility.eligible) {
    ui.muted(`  Tailscale Serve was not configured automatically: ${describeTailscaleEligibility(eligibility)}.`)
  }

  ui.keyValues([
    ['root', manager.config.root],
    ['dashboard', `${localUrl}/`],
    ['immersive', `${localUrl}/xr/`]
  ])

  if (policy === 'disabled' && manager.config.server.host !== DEFAULT_SERVER_HOST) {
    ui.muted('  Remote browsers need HTTPS for WebXR and voice. Remove the host override or use --tailscale-serve for private HTTPS.')
  }
  await app.ready()
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
  const [command = 'start', maybeProjectId] = parsed.positionals
  const stdoutStream = dependencies.stdout ?? process.stdout
  const json = values.json ?? false
  const hasTailscaleOption = Boolean(
    values['tailscale-serve'] || values['no-tailscale-serve']
  )
  // `--json` forces plain mode so a machine consumer never receives styling.
  const ui = createCliUi({
    stream: stdoutStream,
    env: dependencies.env,
    plain: json
  })

  // A bare `codori` shows help rather than silently starting a server, so a
  // first-time user discovers the command surface. An invocation that passes
  // flags but no command still defaults to `start`, which keeps the previously
  // documented `npx @codori/server --root ~/Project` form working.
  if (values.help || argv.length === 0) {
    printUsage(ui)
    return
  }

  const serviceAction = resolveServiceCliAction(command, maybeProjectId)
  if (serviceAction) {
    if (
      hasTailscaleOption
      && serviceAction !== 'install'
      && serviceAction !== 'start'
      && serviceAction !== 'restart'
    ) {
      throw new CodoriError(
        'INVALID_CONFIG',
        'Tailscale Serve options are available only for service install, start, or restart.'
      )
    }
    if (values['experimental-realtime-voice']) {
      throw new CodoriError(
        'INVALID_CONFIG',
        'Installed services configure experimental realtime voice with realtimeVoice.enabled in ~/.codori/config.json. It is enabled by default.'
      )
    }
    await executeServiceCommand(serviceAction, values, dependencies, ui)
    return
  }

  switch (command) {
    case 'list': {
      if (hasTailscaleOption) {
        throw new CodoriError('INVALID_CONFIG', 'Tailscale Serve options are available only for server or service launches.')
      }
      const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
        }
      })
      const statuses = manager.listProjectStatuses()
      if (json) {
        printJson(statuses, stdoutStream)
        return
      }

      if (statuses.length === 0) {
        ui.info(`No Git projects were found under ${ui.bold(manager.config.root)}.`)
        ui.muted('  Codori treats any descendant directory with a direct .git child as a project.')
        ui.muted(`  Point it elsewhere with \`${CLI_BINARY} list --root <path>\`.`)
        return
      }

      ui.line(`${ui.bold(String(statuses.length))} ${statuses.length === 1 ? 'project' : 'projects'} under ${ui.dim(manager.config.root)}`)
      printStatuses(statuses, ui)
      return
    }
    case 'status': {
      if (hasTailscaleOption) {
        throw new CodoriError('INVALID_CONFIG', 'Tailscale Serve options are available only for server or service launches.')
      }
      const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
        }
      })
      if (maybeProjectId) {
        const status = manager.getProjectStatus(maybeProjectId)
        if (json) {
          printJson(status, stdoutStream)
        } else {
          printStatuses([status], ui)
        }
        return
      }

      const statuses = manager.listProjectStatuses()
      if (json) {
        printJson(statuses, stdoutStream)
        return
      }

      if (statuses.length === 0) {
        ui.info(`No Git projects were found under ${ui.bold(manager.config.root)}.`)
        ui.muted(`  Point Codori at another directory with \`${CLI_BINARY} status --root <path>\`.`)
        return
      }

      printStatuses(statuses, ui)
      return
    }
    case 'start': {
      if (!maybeProjectId) {
        await runServerCommand('start', argv, values, dependencies, ui)
        return
      }
      if (hasTailscaleOption) {
        throw new CodoriError('INVALID_CONFIG', 'Tailscale Serve options cannot be used when starting a project runtime.')
      }
      const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
        }
      })
      if (json) {
        printJson(await manager.startProject(maybeProjectId), stdoutStream)
        return
      }

      // Starting a workspace runtime waits on process spawn and port
      // allocation, so it is the one runtime command worth a spinner.
      const result = await ui.task(
        `Starting ${maybeProjectId}`,
        () => manager.startProject(maybeProjectId),
        value => `${value.reusedExisting ? 'Reused' : 'Started'} ${maybeProjectId}`
      )
      ui.keyValues([
        ['port', String(result.port)],
        ['pid', String(result.pid)]
      ])
      return
    }
    case 'stop': {
      if (hasTailscaleOption) {
        throw new CodoriError('INVALID_CONFIG', 'Tailscale Serve options are available only for server or service launches.')
      }
      const manager = (dependencies.createRuntimeManager ?? createRuntimeManager)({
        configOverrides: {
          root: resolveCliRoot(values.root),
          host: values.host,
          port: coercePort(values.port),
          realtimeVoiceEnabled: values['experimental-realtime-voice']
        }
      })
      if (!maybeProjectId) {
        throw new CodoriError('MISSING_PROJECT_ID', 'The stop command requires a project id.')
      }
      if (json) {
        printJson(await manager.stopProject(maybeProjectId), stdoutStream)
        return
      }

      const result = await ui.task(
        `Stopping ${maybeProjectId}`,
        () => manager.stopProject(maybeProjectId),
        () => `Stopped ${maybeProjectId}`
      )
      if (result.error) {
        ui.warn(result.error)
      }
      return
    }
    case 'serve': {
      await runServerCommand('serve', argv, values, dependencies, ui)
      return
    }
    default:
      printUsage(ui)
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

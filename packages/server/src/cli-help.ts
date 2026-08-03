import type { CliUi } from './cli-ui.js'

/**
 * Declarative model for `codori --help`.
 *
 * Help is data rather than a preformatted string so the same definitions can be
 * rendered with color and alignment for a terminal, and flattened to plain text
 * for tests and non-TTY output.
 */

export type CliCommandDoc = {
  /** Invocation shape, e.g. `status [projectId]`. */
  usage: string
  description: string
}

export type CliOptionDoc = {
  flag: string
  description: string
  /** Names the commands the option applies to, when it is not global. */
  appliesTo?: string
}

export const CLI_BINARY = 'codori'
export const CLI_PACKAGE = '@codori/server'
export const CLI_INSTALL_PACKAGE = '@codori/cli'

export const RUNTIME_COMMANDS: CliCommandDoc[] = [
  {
    usage: 'start',
    description: 'Start the Codori server, dashboard, WebXR app, and API.'
  }
]

/**
 * Commands that used to manage individual workspace runtimes from the CLI.
 *
 * They read and mutated local runtime state instead of talking to the running
 * server, which could leave a workspace the server did not know it owned. The
 * dashboard already performs the same operations over the HTTP API, so the CLI
 * keeps only server launch and service management. The names stay known so an
 * old invocation gets a specific reason instead of bare help.
 */
export const RETIRED_RUNTIME_COMMANDS = new Map<string, string>([
  ['list', 'Projects are listed in the dashboard sidebar.'],
  ['status', 'Workspace runtime status is shown in the dashboard sidebar.'],
  ['stop', 'Stop a workspace from the dashboard.']
])

export const SERVICE_COMMANDS: CliCommandDoc[] = [
  {
    usage: 'service install',
    description: 'Register Codori as a background service for the current user.'
  },
  {
    usage: 'service start',
    description: 'Start the registered background service.'
  },
  {
    usage: 'service stop',
    description: 'Stop the registered background service.'
  },
  {
    usage: 'service restart',
    description: 'Restart the registered background service.'
  },
  {
    usage: 'service status',
    description: 'Report whether the registered service is running.'
  },
  {
    usage: 'service uninstall',
    description: 'Remove the registered service and its launcher files.'
  }
]

export const CLI_OPTIONS: CliOptionDoc[] = [
  {
    flag: '--root <path>',
    description: 'Parent directory scanned for Git projects. Defaults to the current directory.'
  },
  {
    flag: '--host <host>',
    description: 'Address the server binds. Defaults to 127.0.0.1.'
  },
  {
    flag: '--port <port>',
    description: 'Port the server binds. Defaults to 4310.'
  },
  {
    flag: '--tailscale-serve',
    description: 'Require private Tailscale Serve HTTPS on loopback.',
    appliesTo: 'start, service install/start/restart'
  },
  {
    flag: '--no-tailscale-serve',
    description: 'Disable automatic private Tailscale Serve HTTPS.',
    appliesTo: 'start, service install/start/restart'
  },
  {
    flag: '--experimental-realtime-voice',
    description: 'Compatibility flag. Realtime voice is already enabled by default.',
    appliesTo: 'start'
  },
  {
    flag: '--scope <user|system>',
    description: 'Service registration scope. System scope requires elevation.',
    appliesTo: 'service'
  },
  {
    flag: '--yes',
    description: 'Accept prompts and use defaults without asking.',
    appliesTo: 'service'
  },
  {
    flag: '-h, --help',
    description: 'Show this help.'
  }
]

export const CLI_EXAMPLES: { command: string, description: string }[] = [
  {
    command: `${CLI_BINARY} start --root ~/Project`,
    description: 'Serve every Git project under ~/Project with automatic private HTTPS.'
  },
  {
    command: `${CLI_BINARY} start --root ~/Project --no-tailscale-serve`,
    description: 'Start locally without configuring Tailscale Serve.'
  },
  {
    command: `${CLI_BINARY} service install`,
    description: 'Keep Codori running in the background across logins.'
  }
]

/**
 * The legacy `*-service` aliases stay accepted by the parser, but they are
 * listed as a short footnote instead of a top-level section so the primary help
 * body advertises only the canonical `service <verb>` form.
 */
export const LEGACY_ALIAS_NOTE
  = 'Deprecated aliases serve, install-service, setup-service, restart-service, and '
  + 'uninstall-service still work; prefer start and service <verb>.'

const renderRows = (
  ui: CliUi,
  rows: { left: string, right: string, note?: string }[]
) => {
  const width = rows.reduce((max, row) => Math.max(max, row.left.length), 0)
  for (const row of rows) {
    const label = ui.accent(row.left.padEnd(width))
    const note = row.note ? ` ${ui.dim(`[${row.note}]`)}` : ''
    ui.line(`  ${label}  ${row.right}${note}`)
  }
}

/**
 * Renders the full help body. Sections are ordered by what a new user needs
 * first: how to invoke, then everyday runtime commands, then background
 * service management, then options and examples.
 */
export const renderCliHelp = (ui: CliUi) => {
  ui.line(`${ui.bold('Codori')} ${ui.dim('- self-hosted remote coding control plane for Codex')}`)
  ui.line()

  ui.heading('Usage')
  ui.line(`  ${ui.accent(CLI_BINARY)} <command> [options]`)
  ui.line()

  ui.heading('Install')
  ui.line(`  ${ui.accent(`npm install -g ${CLI_INSTALL_PACKAGE}`)}`)
  ui.muted(`  Or run without installing: npx ${CLI_PACKAGE} <command> [options]`)
  ui.line()

  ui.heading('Commands')
  renderRows(ui, RUNTIME_COMMANDS.map(command => ({
    left: command.usage,
    right: command.description
  })))
  ui.muted('  Projects and workspace runtimes are managed from the dashboard, not the CLI.')
  ui.line()

  ui.heading('Service')
  renderRows(ui, SERVICE_COMMANDS.map(command => ({
    left: command.usage,
    right: command.description
  })))
  ui.line()

  ui.heading('Options')
  renderRows(ui, CLI_OPTIONS.map(option => ({
    left: option.flag,
    right: option.description,
    note: option.appliesTo
  })))
  ui.line()

  ui.heading('Examples')
  for (const example of CLI_EXAMPLES) {
    ui.muted(`  ${example.description}`)
    ui.line(`  ${ui.accent(`$ ${example.command}`)}`)
  }
  ui.line()

  ui.muted(LEGACY_ALIAS_NOTE)
  ui.muted('Docs: https://github.com/comfuture/codori')
}

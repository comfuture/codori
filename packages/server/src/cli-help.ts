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
    usage: 'serve',
    description: 'Start the Codori server and serve the dashboard, WebXR app, and API.'
  },
  {
    usage: 'list',
    description: 'List the Git projects discovered under the project root.'
  },
  {
    usage: 'status [projectId]',
    description: 'Show runtime status for every workspace, or just one project.'
  },
  {
    usage: 'start <projectId>',
    description: 'Start the workspace runtime for one project.'
  },
  {
    usage: 'stop <projectId>',
    description: 'Stop the workspace runtime for one project.'
  }
]

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
    description: 'Configure private Tailscale Serve HTTPS on loopback.',
    appliesTo: 'serve'
  },
  {
    flag: '--experimental-realtime-voice',
    description: 'Compatibility flag. Realtime voice is already enabled by default.',
    appliesTo: 'serve'
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
    flag: '--json',
    description: 'Emit machine-readable JSON instead of formatted output.',
    appliesTo: 'list, status, start, stop'
  },
  {
    flag: '-h, --help',
    description: 'Show this help.'
  }
]

export const CLI_EXAMPLES: { command: string, description: string }[] = [
  {
    command: `${CLI_BINARY} serve --root ~/Project`,
    description: 'Serve every Git project under ~/Project.'
  },
  {
    command: `${CLI_BINARY} serve --root ~/Project --tailscale-serve`,
    description: 'Serve on loopback behind private Tailscale HTTPS.'
  },
  {
    command: `${CLI_BINARY} list --root ~/Project`,
    description: 'Inspect discovered projects and their runtime state.'
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
  = 'Deprecated aliases install-service, setup-service, restart-service, and '
  + 'uninstall-service still work; prefer service <verb>.'

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

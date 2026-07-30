import { spawn } from 'node:child_process'
import { CodoriError } from './errors.js'

export type TailscaleCommandResult = {
  exitCode: number | null
  stdout: string
  stderr: string
}

export type TailscaleCommandRunner = (
  command: string,
  args: string[]
) => Promise<TailscaleCommandResult>

export type TailscaleServeResult = {
  url: string
  alreadyConfigured: boolean
}

type ServeInspection = {
  state: 'missing' | 'configured'
  url: string | null
}

const TAILSCALE_HTTPS_PORT = 443
const LOOPBACK_HOST = '127.0.0.1'

const defaultCommandRunner: TailscaleCommandRunner = (command, args) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk: Buffer | string) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer | string) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr
      })
    })
  })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const commandFailureMessage = (result: TailscaleCommandResult) =>
  result.stderr.trim()
  || result.stdout.trim()
  || `tailscale exited with code ${result.exitCode ?? 'unknown'}.`

const isHttpsHostPort = (value: string) => value.endsWith(`:${TAILSCALE_HTTPS_PORT}`)

const hostnameFromHostPort = (value: string) => {
  if (!isHttpsHostPort(value)) {
    return null
  }

  const hostname = value.slice(0, -String(`:${TAILSCALE_HTTPS_PORT}`).length)
  return hostname || null
}

const hasTruthyHttpsFunnel = (config: Record<string, unknown>) => {
  if (!isRecord(config.AllowFunnel)) {
    return false
  }

  return Object.entries(config.AllowFunnel)
    .some(([hostPort, enabled]) => isHttpsHostPort(hostPort) && enabled === true)
}

const getHttpsTcpHandler = (config: Record<string, unknown>) => {
  if (!isRecord(config.TCP)) {
    return undefined
  }

  return config.TCP[String(TAILSCALE_HTTPS_PORT)]
}

const getHttpsRootHandlers = (config: Record<string, unknown>) => {
  if (!isRecord(config.Web)) {
    return []
  }

  return Object.entries(config.Web).flatMap(([hostPort, webConfig]) => {
    if (!isHttpsHostPort(hostPort) || !isRecord(webConfig) || !isRecord(webConfig.Handlers)) {
      return []
    }

    const rootHandler = webConfig.Handlers['/']
    return rootHandler === undefined
      ? []
      : [{ hostPort, handler: rootHandler }]
  })
}

const hasHttpsConfiguration = (config: Record<string, unknown>) =>
  getHttpsTcpHandler(config) !== undefined
  || getHttpsRootHandlers(config).length > 0
  || hasTruthyHttpsFunnel(config)

const inspectServeStatus = (
  status: unknown,
  expectedTarget: string
): ServeInspection => {
  if (!isRecord(status)) {
    throw new CodoriError(
      'TAILSCALE_SERVE_INVALID_STATUS',
      'Tailscale Serve returned an invalid structured status.'
    )
  }

  if (isRecord(status.Foreground)) {
    const foregroundConflict = Object.values(status.Foreground)
      .some(config => isRecord(config) && hasHttpsConfiguration(config))
    if (foregroundConflict) {
      throw new CodoriError(
        'TAILSCALE_SERVE_CONFLICT',
        'A foreground Tailscale Serve or Funnel listener already uses HTTPS port 443. Stop it before launching Codori with --tailscale-serve.'
      )
    }
  }

  if (hasTruthyHttpsFunnel(status)) {
    throw new CodoriError(
      'TAILSCALE_SERVE_CONFLICT',
      'Tailscale Funnel already uses HTTPS port 443. Codori will not disable or replace public Funnel exposure.'
    )
  }

  const tcpHandler = getHttpsTcpHandler(status)
  if (
    tcpHandler !== undefined
    && (!isRecord(tcpHandler) || tcpHandler.HTTPS !== true)
  ) {
    throw new CodoriError(
      'TAILSCALE_SERVE_CONFLICT',
      'A non-HTTPS Tailscale listener already uses port 443. Codori will not replace it.'
    )
  }

  const configuredUrls: string[] = []
  for (const { hostPort, handler } of getHttpsRootHandlers(status)) {
    const proxy = isRecord(handler) ? handler.Proxy : undefined
    if (proxy !== expectedTarget) {
      throw new CodoriError(
        'TAILSCALE_SERVE_CONFLICT',
        `Tailscale Serve already maps the HTTPS root to ${
          typeof proxy === 'string' ? proxy : 'a non-proxy handler'
        }. Codori will not replace it.`
      )
    }

    const hostname = hostnameFromHostPort(hostPort)
    if (hostname) {
      configuredUrls.push(`https://${hostname}/`)
    }
  }

  if (configuredUrls.length === 0) {
    return {
      state: 'missing',
      url: null
    }
  }

  if (!isRecord(tcpHandler) || tcpHandler.HTTPS !== true) {
    throw new CodoriError(
      'TAILSCALE_SERVE_INVALID_STATUS',
      'Tailscale Serve reports the Codori proxy without an HTTPS listener on port 443.'
    )
  }

  configuredUrls.sort()
  return {
    state: 'configured',
    url: configuredUrls[0] ?? null
  }
}

const readServeStatus = async (
  runCommand: TailscaleCommandRunner
): Promise<unknown> => {
  let result: TailscaleCommandResult
  try {
    result = await runCommand('tailscale', ['serve', 'status', '--json'])
  } catch (error) {
    throw new CodoriError(
      'TAILSCALE_SERVE_UNAVAILABLE',
      'Unable to run Tailscale. Install Tailscale, start its daemon, and join this machine to a tailnet before using --tailscale-serve.',
      error
    )
  }

  if (result.exitCode !== 0) {
    throw new CodoriError(
      'TAILSCALE_SERVE_UNAVAILABLE',
      `Unable to inspect Tailscale Serve: ${commandFailureMessage(result)}`
    )
  }

  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new CodoriError(
      'TAILSCALE_SERVE_INVALID_STATUS',
      'Tailscale Serve returned malformed JSON from `tailscale serve status --json`.',
      error
    )
  }
}

export const configureTailscaleServe = async (
  port: number,
  runCommand: TailscaleCommandRunner = defaultCommandRunner
): Promise<TailscaleServeResult> => {
  const target = `http://${LOOPBACK_HOST}:${port}`
  const initialInspection = inspectServeStatus(
    await readServeStatus(runCommand),
    target
  )

  if (initialInspection.state === 'configured' && initialInspection.url) {
    return {
      url: initialInspection.url,
      alreadyConfigured: true
    }
  }

  let result: TailscaleCommandResult
  try {
    result = await runCommand('tailscale', [
      'serve',
      '--bg',
      '--yes',
      `--https=${TAILSCALE_HTTPS_PORT}`,
      target
    ])
  } catch (error) {
    throw new CodoriError(
      'TAILSCALE_SERVE_FAILED',
      'Unable to configure Tailscale Serve. Confirm the Tailscale daemon is running and HTTPS is enabled for the tailnet.',
      error
    )
  }

  if (result.exitCode !== 0) {
    throw new CodoriError(
      'TAILSCALE_SERVE_FAILED',
      `Unable to configure Tailscale Serve: ${commandFailureMessage(result)}`
    )
  }

  const verified = inspectServeStatus(
    await readServeStatus(runCommand),
    target
  )
  if (verified.state !== 'configured' || !verified.url) {
    const tailscaleOutput = [result.stdout.trim(), result.stderr.trim()]
      .filter(Boolean)
      .join('\n')
    throw new CodoriError(
      'TAILSCALE_SERVE_VERIFY_FAILED',
      [
        'Tailscale accepted the Serve command but did not report the expected HTTPS root proxy.',
        tailscaleOutput ? `Tailscale output: ${tailscaleOutput}` : null
      ].filter(Boolean).join(' ')
    )
  }

  return {
    url: verified.url,
    alreadyConfigured: false
  }
}

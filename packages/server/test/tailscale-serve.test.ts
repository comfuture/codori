import { describe, expect, it, vi } from 'vitest'
import {
  configureTailscaleServe,
  detectTailscaleServeEligibility,
  type TailscaleCommandResult
} from '../src/tailscale-serve.js'

const result = (
  stdout: string,
  overrides: Partial<TailscaleCommandResult> = {}
): TailscaleCommandResult => ({
  exitCode: 0,
  stdout,
  stderr: '',
  ...overrides
})

const configuredStatus = (
  proxy = 'http://127.0.0.1:4310',
  hostname = 'codori-host.example.ts.net'
) => JSON.stringify({
  TCP: {
    443: {
      HTTPS: true
    }
  },
  Web: {
    [`${hostname}:443`]: {
      Handlers: {
        '/': {
          Proxy: proxy
        }
      }
    }
  }
})

describe('configureTailscaleServe', () => {
  it('configures and verifies a missing private HTTPS mapping', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce(result('{}'))
      .mockResolvedValueOnce(result('Serve started and running in the background.'))
      .mockResolvedValueOnce(result(configuredStatus()))

    await expect(configureTailscaleServe(4310, runCommand)).resolves.toEqual({
      url: 'https://codori-host.example.ts.net/',
      alreadyConfigured: false
    })
    expect(runCommand.mock.calls).toEqual([
      ['tailscale', ['serve', 'status', '--json']],
      ['tailscale', [
        'serve',
        '--bg',
        '--yes',
        '--https=443',
        'http://127.0.0.1:4310'
      ]],
      ['tailscale', ['serve', 'status', '--json']]
    ])
  })

  it('reuses the exact existing mapping without mutating Serve', async () => {
    const runCommand = vi.fn().mockResolvedValue(result(configuredStatus()))

    await expect(configureTailscaleServe(4310, runCommand)).resolves.toEqual({
      url: 'https://codori-host.example.ts.net/',
      alreadyConfigured: true
    })
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('refuses to overwrite a different HTTPS root mapping', async () => {
    const runCommand = vi.fn().mockResolvedValue(result(
      configuredStatus('http://127.0.0.1:3000')
    ))

    await expect(configureTailscaleServe(4310, runCommand)).rejects.toMatchObject({
      code: 'TAILSCALE_SERVE_CONFLICT'
    })
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('refuses to disable Funnel on HTTPS port 443', async () => {
    const runCommand = vi.fn().mockResolvedValue(result(JSON.stringify({
      AllowFunnel: {
        'codori-host.example.ts.net:443': true
      }
    })))

    await expect(configureTailscaleServe(4310, runCommand)).rejects.toThrow(
      /will not disable or replace public Funnel exposure/
    )
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('refuses to replace a foreground HTTPS listener', async () => {
    const runCommand = vi.fn().mockResolvedValue(result(JSON.stringify({
      Foreground: {
        session: JSON.parse(configuredStatus())
      }
    })))

    await expect(configureTailscaleServe(4310, runCommand)).rejects.toThrow(
      /foreground Tailscale Serve or Funnel listener/
    )
    expect(runCommand).toHaveBeenCalledTimes(1)
  })

  it('reports malformed structured status', async () => {
    const runCommand = vi.fn().mockResolvedValue(result('not-json'))

    await expect(configureTailscaleServe(4310, runCommand)).rejects.toMatchObject({
      code: 'TAILSCALE_SERVE_INVALID_STATUS'
    })
  })

  it('reports a missing Tailscale executable as an actionable prerequisite', async () => {
    const runCommand = vi.fn().mockRejectedValue(new Error('spawn tailscale ENOENT'))

    await expect(configureTailscaleServe(4310, runCommand)).rejects.toMatchObject({
      code: 'TAILSCALE_SERVE_UNAVAILABLE',
      message: expect.stringMatching(/Install Tailscale/)
    })
  })

  it('reports a failed Serve command and does not claim configuration', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce(result('{}'))
      .mockResolvedValueOnce(result('', {
        exitCode: 1,
        stderr: 'HTTPS must be enabled for this tailnet'
      }))

    await expect(configureTailscaleServe(4310, runCommand)).rejects.toThrow(
      /HTTPS must be enabled/
    )
    expect(runCommand).toHaveBeenCalledTimes(2)
  })

  it('requires the expected mapping after the Serve command succeeds', async () => {
    const runCommand = vi.fn()
      .mockResolvedValueOnce(result('{}'))
      .mockResolvedValueOnce(result('configured'))
      .mockResolvedValueOnce(result('{}'))

    await expect(configureTailscaleServe(4310, runCommand)).rejects.toMatchObject({
      code: 'TAILSCALE_SERVE_VERIFY_FAILED',
      message: expect.stringContaining('Tailscale output: configured')
    })
  })

  it('preserves unrelated HTTPS path handlers while adding the root', async () => {
    const statusWithOtherPath = JSON.stringify({
      TCP: {
        443: {
          HTTPS: true
        }
      },
      Web: {
        'codori-host.example.ts.net:443': {
          Handlers: {
            '/metrics': {
              Proxy: 'http://127.0.0.1:9090'
            }
          }
        }
      }
    })
    const runCommand = vi.fn()
      .mockResolvedValueOnce(result(statusWithOtherPath))
      .mockResolvedValueOnce(result('configured'))
      .mockResolvedValueOnce(result(JSON.stringify({
        TCP: {
          443: {
            HTTPS: true
          }
        },
        Web: {
          'codori-host.example.ts.net:443': {
            Handlers: {
              '/': {
                Proxy: 'http://127.0.0.1:4310'
              },
              '/metrics': {
                Proxy: 'http://127.0.0.1:9090'
              }
            }
          }
        }
      })))

    await expect(configureTailscaleServe(4310, runCommand)).resolves.toEqual({
      url: 'https://codori-host.example.ts.net/',
      alreadyConfigured: false
    })
  })
})

describe('detectTailscaleServeEligibility', () => {
  it('accepts a running node with a MagicDNS identity', async () => {
    const runCommand = vi.fn().mockResolvedValue(result(JSON.stringify({
      BackendState: 'Running',
      MagicDNSSuffix: 'example.ts.net',
      Self: {
        DNSName: 'codori-host.example.ts.net.'
      }
    })))

    await expect(detectTailscaleServeEligibility(runCommand)).resolves.toEqual({
      eligible: true,
      dnsName: 'codori-host.example.ts.net',
      reason: 'available'
    })
    expect(runCommand).toHaveBeenCalledWith('tailscale', ['status', '--json'])
  })

  it('rejects stopped, malformed, and MagicDNS-less states without throwing', async () => {
    await expect(detectTailscaleServeEligibility(vi.fn().mockResolvedValue(result(JSON.stringify({
      BackendState: 'Stopped'
    }))))).resolves.toMatchObject({
      eligible: false,
      reason: 'not-running'
    })

    await expect(detectTailscaleServeEligibility(vi.fn().mockResolvedValue(result(JSON.stringify({
      BackendState: 'Running',
      Self: { DNSName: 'codori-host' }
    }))))).resolves.toMatchObject({
      eligible: false,
      reason: 'magicdns-unavailable'
    })

    await expect(detectTailscaleServeEligibility(vi.fn().mockResolvedValue(result('not-json'))))
      .resolves.toMatchObject({
        eligible: false,
        reason: 'unavailable'
      })
  })
})

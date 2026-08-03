import { describe, expect, it } from 'vitest'
import { CodoriError, formatCliError } from '../src/errors.js'

describe('formatCliError', () => {
  it('prints the underlying reason a service command failed', () => {
    // A failed `systemctl` used to surface only the command line, so a user saw
    // `Command failed: systemctl --user enable --now ...` with no reason.
    const error = new CodoriError(
      'SERVICE_COMMAND_FAILED',
      'Command failed: systemctl --user enable --now codori-abc.service',
      'Failed to start codori-abc.service: Unit codori-abc.service has a bad unit file setting.\nSee user logs for details.'
    )

    expect(formatCliError(error)).toBe([
      'SERVICE_COMMAND_FAILED: Command failed: systemctl --user enable --now codori-abc.service',
      '  Failed to start codori-abc.service: Unit codori-abc.service has a bad unit file setting.',
      '  See user logs for details.',
      ''
    ].join('\n'))
  })

  it('omits the detail block when there is no detail', () => {
    const error = new CodoriError('MISSING_ROOT', 'Project root is required.')

    expect(formatCliError(error)).toBe('MISSING_ROOT: Project root is required.\n')
  })

  it('ignores blank detail rather than printing an empty line', () => {
    const error = new CodoriError('SERVICE_COMMAND_FAILED', 'Command failed: systemctl', '   \n  ')

    expect(formatCliError(error)).toBe('SERVICE_COMMAND_FAILED: Command failed: systemctl\n')
  })

  it('unwraps an Error passed as detail', () => {
    const error = new CodoriError('SERVICE_COMMAND_FAILED', 'Failed to execute systemctl.', new Error('spawn ENOENT'))

    expect(formatCliError(error)).toBe('SERVICE_COMMAND_FAILED: Failed to execute systemctl.\n  spawn ENOENT\n')
  })

  it('falls back to a plain message for a non-Codori error', () => {
    expect(formatCliError(new Error('boom'))).toBe('boom\n')
    expect(formatCliError('boom')).toBe('boom\n')
  })
})

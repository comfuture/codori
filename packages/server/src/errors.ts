export class CodoriError extends Error {
  readonly code: string

  readonly details?: unknown

  constructor(code: string, message: string, details?: unknown) {
    super(message)
    this.name = 'CodoriError'
    this.code = code
    this.details = details
  }
}

export const asErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const asDetailText = (details: unknown): string | null => {
  if (details === null || details === undefined) {
    return null
  }

  const text = details instanceof Error
    ? details.message
    : typeof details === 'string' ? details : String(details)
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Renders a failure for stderr, including the underlying reason.
 *
 * `CodoriError.details` carries the output of whatever actually failed, such as
 * `systemctl`'s explanation of a rejected unit. Printing only `code` and
 * `message` left a user with `Command failed: systemctl --user enable --now ...`
 * and no way to learn why, so the detail is shown as indented follow-up lines
 * instead of being flattened into the message.
 */
export const formatCliError = (error: unknown) => {
  if (!(error instanceof CodoriError)) {
    return `${asErrorMessage(error)}\n`
  }

  const lines = [`${error.code}: ${error.message}`]
  const detail = asDetailText(error.details)
  if (detail) {
    for (const line of detail.split('\n')) {
      lines.push(`  ${line.trimEnd()}`)
    }
  }

  return `${lines.join('\n')}\n`
}

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


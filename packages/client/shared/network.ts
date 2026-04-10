const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '')

const hasWindow = () => typeof window !== 'undefined'

const deriveWindowOrigin = () => {
  if (!hasWindow()) {
    return null
  }

  return window.location.origin
}

export const resolveHttpBase = (configuredBase: string | null | undefined) => {
  if (configuredBase && configuredBase.trim().length > 0) {
    return trimTrailingSlash(configuredBase)
  }

  return deriveWindowOrigin() ?? 'http://127.0.0.1:4310'
}

export const shouldUseServerProxy = (configuredBase: string | null | undefined) =>
  Boolean(configuredBase && configuredBase.trim().length > 0)

export const resolveWsBase = (
  configuredWsBase: string | null | undefined,
  configuredHttpBase: string | null | undefined
) => {
  if (configuredWsBase && configuredWsBase.trim().length > 0) {
    return trimTrailingSlash(configuredWsBase)
  }

  const httpBase = resolveHttpBase(configuredHttpBase)
  return httpBase.replace(/^https?/i, (protocol) => protocol.toLowerCase() === 'https' ? 'wss' : 'ws')
}

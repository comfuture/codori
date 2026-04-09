import { useRuntimeConfig } from '#imports'
import { encodeProjectIdSegment } from '~~/shared/codori.js'
import { CodexRpcClient } from '~~/shared/codex-rpc.js'

const clients = new Map<string, CodexRpcClient>()

export const useRpc = () => {
  const runtimeConfig = useRuntimeConfig()

  const getClient = (projectId: string) => {
    const cacheKey = projectId
    const existing = clients.get(cacheKey)
    if (existing) {
      return existing
    }

    const wsBase = String(runtimeConfig.public.codoriServerWsBase)
    const url = new URL(
      `/api/projects/${encodeProjectIdSegment(projectId)}/rpc`,
      wsBase
    ).toString()
    const client = new CodexRpcClient(url)
    clients.set(cacheKey, client)
    return client
  }

  return {
    getClient
  }
}

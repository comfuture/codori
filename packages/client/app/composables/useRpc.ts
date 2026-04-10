import { useRuntimeConfig } from '#imports'
import { encodeProjectIdSegment } from '~~/shared/codori'
import { CodexRpcClient } from '~~/shared/codex-rpc'
import { resolveWsBase } from '~~/shared/network'

const clients = new Map<string, CodexRpcClient>()

export const useRpc = () => {
  const runtimeConfig = useRuntimeConfig()

  const getClient = (projectId: string) => {
    const cacheKey = projectId
    const existing = clients.get(cacheKey)
    if (existing) {
      return existing
    }

    const wsBase = resolveWsBase(
      String(runtimeConfig.public.serverWsBase ?? ''),
      String(runtimeConfig.public.serverBase ?? '')
    )
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

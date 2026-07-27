import { useRuntimeConfig } from '#imports'
import { CodexRpcClient } from '~~/shared/codex-rpc'
import {
  resolveWorkspaceRpcUrl,
  workspaceKey,
  type RpcWorkspace
} from '~~/shared/workspace'

export type { RpcWorkspace } from '~~/shared/workspace'

export type RpcWorkspaceClient = {
  workspace: RpcWorkspace
  client: CodexRpcClient
}

const clients = new Map<string, RpcWorkspaceClient>()
const clientObservers = new Set<(entry: RpcWorkspaceClient) => void>()

export const listRpcWorkspaceClients = () => [...clients.values()]

export const observeRpcWorkspaceClients = (observer: (entry: RpcWorkspaceClient) => void) => {
  clientObservers.add(observer)
  for (const entry of clients.values()) {
    observer(entry)
  }
  return () => {
    clientObservers.delete(observer)
  }
}

export const useRpc = () => {
  const runtimeConfig = useRuntimeConfig()

  const createWorkspaceClient = (workspace: RpcWorkspace) => {
    const url = resolveWorkspaceRpcUrl({
      workspace,
      configuredWsBase: String(runtimeConfig.public.serverWsBase ?? ''),
      configuredHttpBase: String(runtimeConfig.public.serverBase ?? '')
    })
    return new CodexRpcClient(url)
  }

  const getWorkspaceClient = (workspace: RpcWorkspace) => {
    const cacheKey = workspaceKey(workspace)
    const existing = clients.get(cacheKey)
    if (existing) {
      return existing.client
    }

    const client = createWorkspaceClient(workspace)
    const entry = { workspace, client }
    clients.set(cacheKey, entry)
    for (const observer of clientObservers) {
      observer(entry)
    }
    return client
  }

  const getClient = (projectId: string) =>
    getWorkspaceClient({ kind: 'project', id: projectId })

  const getChatClient = (chatId: string) =>
    getWorkspaceClient({ kind: 'chat', id: chatId })

  return {
    getClient,
    getChatClient,
    getWorkspaceClient,
    createWorkspaceClient
  }
}

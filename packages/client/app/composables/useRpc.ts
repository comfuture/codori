import { useRuntimeConfig } from '#imports'
import { encodeChatIdSegment, encodeProjectIdSegment } from '~~/shared/codori'
import { CodexRpcClient } from '~~/shared/codex-rpc'
import { resolveWsBase } from '~~/shared/network'

export type RpcWorkspace = { kind: 'project', id: string } | { kind: 'chat', id: string }

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
    const wsBase = resolveWsBase(
      String(runtimeConfig.public.serverWsBase ?? ''),
      String(runtimeConfig.public.serverBase ?? '')
    )
    const requestPath = workspace.kind === 'chat'
      ? `/api/chats/${encodeChatIdSegment(workspace.id)}/rpc`
      : `/api/projects/${encodeProjectIdSegment(workspace.id)}/rpc`
    const url = new URL(
      requestPath,
      wsBase
    ).toString()
    return new CodexRpcClient(url)
  }

  const getWorkspaceClient = (workspace: RpcWorkspace) => {
    const cacheKey = `${workspace.kind}:${workspace.id}`
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

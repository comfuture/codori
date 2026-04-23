import { useRuntimeConfig } from '#imports'
import { encodeChatIdSegment, encodeProjectIdSegment } from '~~/shared/codori'
import { CodexRpcClient } from '~~/shared/codex-rpc'
import { resolveWsBase } from '~~/shared/network'

const clients = new Map<string, CodexRpcClient>()

export const useRpc = () => {
  const runtimeConfig = useRuntimeConfig()

  const getWorkspaceClient = (workspace: { kind: 'project', id: string } | { kind: 'chat', id: string }) => {
    const cacheKey = `${workspace.kind}:${workspace.id}`
    const existing = clients.get(cacheKey)
    if (existing) {
      return existing
    }

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
    const client = new CodexRpcClient(url)
    clients.set(cacheKey, client)
    return client
  }

  const getClient = (projectId: string) =>
    getWorkspaceClient({ kind: 'project', id: projectId })

  const getChatClient = (chatId: string) =>
    getWorkspaceClient({ kind: 'chat', id: chatId })

  return {
    getClient,
    getChatClient,
    getWorkspaceClient
  }
}

import type { ProjectLocalFileResponse } from './local-files'

export type LocalFileRpcClient = {
  request<T>(method: 'codori/localFile/read', params: { path: string }): Promise<T>
}

export const readWorkspaceLocalFile = (
  client: LocalFileRpcClient,
  path: string
) => client.request<ProjectLocalFileResponse>('codori/localFile/read', { path })

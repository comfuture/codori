import { encodeChatIdSegment, encodeProjectIdSegment } from './codori'
import type { WorkspaceLocalFileScope } from './local-files'
import { resolveApiUrl, shouldUseServerProxy } from './network'

export type WorkspaceDirectoryEntryErrorCode =
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'UNSUPPORTED'

export type WorkspaceDirectoryEntry = {
  name: string
  path: string
  kind: 'directory' | 'file' | 'other'
  size: number | null
  updatedAt: number | null
  isSymlink: boolean
  accessible: boolean
  hidden: boolean
  ignored: boolean
  errorCode?: WorkspaceDirectoryEntryErrorCode
}

export type WorkspaceDirectoryListing = {
  path: string
  entries: WorkspaceDirectoryEntry[]
  truncated: boolean
  limit: number
}

export type WorkspaceDirectoryResponse = {
  directory: WorkspaceDirectoryListing
}

export const resolveWorkspaceDirectoryUrl = (input: {
  workspace: WorkspaceLocalFileScope
  path: string
  showIgnored: boolean
  configuredBase?: string | null
}) => {
  const query = new URLSearchParams({ path: input.path })
  if (input.showIgnored) {
    query.set('showIgnored', 'true')
  }

  const requestPath = input.workspace.kind === 'chat'
    ? `/chats/${encodeChatIdSegment(input.workspace.id)}/files?${query.toString()}`
    : `/projects/${encodeProjectIdSegment(input.workspace.id)}/files?${query.toString()}`

  if (shouldUseServerProxy(input.configuredBase)) {
    return `/api/codori${requestPath}`
  }

  return resolveApiUrl(requestPath, input.configuredBase)
}

export const workspacePathBreadcrumbs = (path: string) => {
  const segments = path ? path.split('/') : []
  return [
    { label: 'Workspace', path: '' },
    ...segments.map((label, index) => ({
      label,
      path: segments.slice(0, index + 1).join('/')
    }))
  ]
}

export const fallbackWorkspacePathAfterRemoval = (
  currentPath: string,
  removedDirectoryPath: string
) => {
  if (
    currentPath !== removedDirectoryPath
    && !currentPath.startsWith(`${removedDirectoryPath}/`)
  ) {
    return currentPath
  }

  return removedDirectoryPath.includes('/')
    ? removedDirectoryPath.slice(0, removedDirectoryPath.lastIndexOf('/'))
    : ''
}

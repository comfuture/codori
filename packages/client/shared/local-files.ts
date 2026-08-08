import { encodeChatIdSegment, encodeProjectIdSegment } from './codori'
import { resolveApiUrl, shouldUseServerProxy } from './network'

export type LocalFileLinkTarget = {
  kind: 'workspace-relative' | 'local-absolute'
  path: string
  line: number | null
  column: number | null
}

type LocalFileResponseBase = {
  path: string
  relativePath: string
  name: string
  size: number
  updatedAt: number
}

export type LocalFileTextResponse = LocalFileResponseBase & {
  kind: 'text'
  text: string
}

export type LocalFileImageResponse = LocalFileResponseBase & {
  kind: 'image'
  mediaType: string
  base64: string
}

export type ProjectLocalFileResponse = {
  file: LocalFileTextResponse | LocalFileImageResponse
}

export type WorkspaceLocalFileScope =
  | { kind: 'project', id: string }
  | { kind: 'chat', id: string }

const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/u
const URL_SCHEME_RE = /^[A-Za-z][A-Za-z\d+.-]*:/u
const NON_FILE_URL_SCHEME_RE = /^(?:https?|mailto|tel|sms|data|blob|ftp|ftps|ssh|git|vscode(?:-insiders)?):/iu
const FILE_LOCATION_SUFFIX_RE = /:\d+(?::\d+)?$/u

const normalizeComparablePath = (value: string) => {
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  return WINDOWS_ABSOLUTE_PATH_RE.test(normalized)
    ? normalized.toLowerCase()
    : normalized
}

export const parseLocalFileHref = (href: string): LocalFileLinkTarget | null => {
  const trimmed = href.trim()
  if (!trimmed) {
    return null
  }

  let decoded: string
  try {
    decoded = decodeURIComponent(trimmed)
  } catch {
    return null
  }

  if (decoded.startsWith('file://')) {
    const filePath = decoded
      .slice('file://'.length)
      .replace(/^\/(?=[A-Za-z]:[\\/])/u, '')

    return parseLocalFileHref(filePath)
  }

  if (
    decoded.startsWith('#')
    || decoded.startsWith('?')
    || decoded.startsWith('//')
    || (
      URL_SCHEME_RE.test(decoded)
      && !WINDOWS_ABSOLUTE_PATH_RE.test(decoded)
      && (
        decoded.includes('://')
        || NON_FILE_URL_SCHEME_RE.test(decoded)
        || !FILE_LOCATION_SUFFIX_RE.test(decoded)
      )
    )
  ) {
    return null
  }

  if (WINDOWS_ABSOLUTE_PATH_RE.test(decoded)) {
    const match = /^(?<path>[A-Za-z]:[\\/].*?)(?::(?<line>\d+))?(?::(?<column>\d+))?$/u.exec(decoded)
    if (!match?.groups?.path) {
      return null
    }

    return {
      kind: 'local-absolute',
      path: match.groups.path,
      line: match.groups.line ? Number.parseInt(match.groups.line, 10) : null,
      column: match.groups.column ? Number.parseInt(match.groups.column, 10) : null
    }
  }

  const match = /^(?<path>.+?)(?::(?<line>\d+))?(?::(?<column>\d+))?$/u.exec(decoded)
  if (!match?.groups?.path) {
    return null
  }

  const path = match.groups.path
  if (!path.trim() || path === '.' || path === '..') {
    return null
  }

  return {
    kind: path.startsWith('/') ? 'local-absolute' : 'workspace-relative',
    path,
    line: match.groups.line ? Number.parseInt(match.groups.line, 10) : null,
    column: match.groups.column ? Number.parseInt(match.groups.column, 10) : null
  }
}

export const isLocalFileWithinProject = (
  path: string,
  projectPath: string | null | undefined
) => {
  if (!projectPath) {
    return false
  }

  const normalizedPath = normalizeComparablePath(path)
  const normalizedProjectPath = normalizeComparablePath(projectPath)
  return normalizedPath === normalizedProjectPath || normalizedPath.startsWith(`${normalizedProjectPath}/`)
}

export const resolveProjectLocalFileUrl = (input: {
  projectId?: string
  workspace?: WorkspaceLocalFileScope
  path: string
  configuredBase?: string | null
}) => {
  const query = new URLSearchParams({ path: input.path })
  const workspace = input.workspace ?? { kind: 'project' as const, id: input.projectId ?? '' }
  const requestPath = workspace.kind === 'chat'
    ? `/chats/${encodeChatIdSegment(workspace.id)}/local-file?${query.toString()}`
    : `/projects/${encodeProjectIdSegment(workspace.id)}/local-file?${query.toString()}`

  if (shouldUseServerProxy(input.configuredBase)) {
    return `/api/codori${requestPath}`
  }

  return resolveApiUrl(requestPath, input.configuredBase)
}

export const formatLocalFileSize = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

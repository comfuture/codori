import { encodeProjectIdSegment } from './codori'
import { resolveApiUrl, shouldUseServerProxy } from './network'

export type LocalFileLinkTarget = {
  path: string
  line: number | null
  column: number | null
}

export type ProjectLocalFileResponse = {
  file: {
    path: string
    relativePath: string
    name: string
    size: number
    updatedAt: number
    text: string
  }
}

const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/u

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

  if (decoded.startsWith('http://') || decoded.startsWith('https://') || decoded.startsWith('mailto:')) {
    return null
  }

  if (WINDOWS_ABSOLUTE_PATH_RE.test(decoded)) {
    const match = /^(?<path>[A-Za-z]:[\\/].*?)(?::(?<line>\d+))?(?::(?<column>\d+))?$/u.exec(decoded)
    if (!match?.groups?.path) {
      return null
    }

    return {
      path: match.groups.path,
      line: match.groups.line ? Number.parseInt(match.groups.line, 10) : null,
      column: match.groups.column ? Number.parseInt(match.groups.column, 10) : null
    }
  }

  if (!decoded.startsWith('/')) {
    return null
  }

  const match = /^(?<path>\/.*?)(?::(?<line>\d+))?(?::(?<column>\d+))?$/u.exec(decoded)
  if (!match?.groups?.path) {
    return null
  }

  return {
    path: match.groups.path,
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
  projectId: string
  path: string
  configuredBase?: string | null
}) => {
  const query = new URLSearchParams({ path: input.path })
  const requestPath = `/projects/${encodeProjectIdSegment(input.projectId)}/local-file?${query.toString()}`

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

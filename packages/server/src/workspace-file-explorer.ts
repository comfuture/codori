import { lstat, opendir, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { isPathInsideDirectory } from './attachment-store.js'
import { IGNORED_PROJECT_DIRECTORY_NAMES } from './project-scanner.js'

export const MAX_WORKSPACE_DIRECTORY_ENTRIES = 200

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

export class WorkspaceDirectoryError extends Error {
  readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'NOT_A_DIRECTORY' | 'PERMISSION_DENIED'

  constructor(
    code: WorkspaceDirectoryError['code'],
    message: string
  ) {
    super(message)
    this.name = 'WorkspaceDirectoryError'
    this.code = code
  }
}

const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/u

export const normalizeWorkspaceRelativePath = (requestedPath: string) => {
  if (requestedPath === '') {
    return ''
  }

  if (
    requestedPath.includes('\0')
    || requestedPath.includes('\\')
    || requestedPath.startsWith('/')
    || WINDOWS_ABSOLUTE_PATH_RE.test(requestedPath)
    || isAbsolute(requestedPath)
  ) {
    throw new WorkspaceDirectoryError(
      'FORBIDDEN',
      'Workspace directory paths must be root-relative.'
    )
  }

  const segments = requestedPath.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new WorkspaceDirectoryError(
      'FORBIDDEN',
      'Workspace directory traversal is not allowed.'
    )
  }

  return segments.join('/')
}

const toEntryErrorCode = (error: unknown): WorkspaceDirectoryEntryErrorCode => {
  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM') {
    return 'PERMISSION_DENIED'
  }
  if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') {
    return 'NOT_FOUND'
  }
  return 'UNSUPPORTED'
}

const toDirectoryError = (error: unknown): WorkspaceDirectoryError => {
  if (error instanceof WorkspaceDirectoryError) {
    return error
  }

  const code = (error as NodeJS.ErrnoException).code
  if (code === 'EACCES' || code === 'EPERM') {
    return new WorkspaceDirectoryError('PERMISSION_DENIED', 'Workspace directory is not readable.')
  }

  if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') {
    return new WorkspaceDirectoryError('NOT_FOUND', 'Workspace directory not found.')
  }

  throw error
}

const classifyEntry = (entryStat: Awaited<ReturnType<typeof stat>>) => {
  if (entryStat.isDirectory()) {
    return 'directory' as const
  }
  if (entryStat.isFile()) {
    return 'file' as const
  }
  return 'other' as const
}

const inspectDirectoryEntry = async (input: {
  root: string
  directory: string
  directoryPath: string
  name: string
}): Promise<WorkspaceDirectoryEntry> => {
  const entryPath = resolve(input.directory, input.name)
  const relativePath = input.directoryPath
    ? `${input.directoryPath}/${input.name}`
    : input.name
  const hidden = input.name.startsWith('.')
  const ignored = IGNORED_PROJECT_DIRECTORY_NAMES.has(input.name)

  let entryLstat: Awaited<ReturnType<typeof lstat>>
  try {
    entryLstat = await lstat(entryPath)
  } catch (error) {
    return {
      name: input.name,
      path: relativePath,
      kind: 'other',
      size: null,
      updatedAt: null,
      isSymlink: false,
      accessible: false,
      hidden,
      ignored,
      errorCode: toEntryErrorCode(error)
    }
  }

  const isSymlink = entryLstat.isSymbolicLink()
  if (input.name.includes('\\')) {
    return {
      name: input.name,
      path: relativePath,
      kind: 'other',
      size: null,
      updatedAt: entryLstat.mtimeMs,
      isSymlink,
      accessible: false,
      hidden,
      ignored,
      errorCode: 'UNSUPPORTED'
    }
  }

  let resolvedEntryPath = entryPath

  if (isSymlink) {
    try {
      resolvedEntryPath = await realpath(entryPath)
    } catch (error) {
      return {
        name: input.name,
        path: relativePath,
        kind: 'other',
        size: null,
        updatedAt: entryLstat.mtimeMs,
        isSymlink: true,
        accessible: false,
        hidden,
        ignored,
        errorCode: toEntryErrorCode(error)
      }
    }

    if (!isPathInsideDirectory(resolvedEntryPath, input.root)) {
      return {
        name: input.name,
        path: relativePath,
        kind: 'other',
        size: null,
        updatedAt: entryLstat.mtimeMs,
        isSymlink: true,
        accessible: false,
        hidden,
        ignored,
        errorCode: 'FORBIDDEN'
      }
    }
  }

  let entryStat: Awaited<ReturnType<typeof stat>>
  try {
    entryStat = isSymlink ? await stat(resolvedEntryPath) : entryLstat
  } catch (error) {
    return {
      name: input.name,
      path: relativePath,
      kind: 'other',
      size: null,
      updatedAt: entryLstat.mtimeMs,
      isSymlink,
      accessible: false,
      hidden,
      ignored,
      errorCode: toEntryErrorCode(error)
    }
  }

  const kind = classifyEntry(entryStat)
  return {
    name: input.name,
    path: relativePath,
    kind,
    size: kind === 'file' ? entryStat.size : null,
    updatedAt: entryStat.mtimeMs,
    isSymlink,
    accessible: kind === 'directory' || kind === 'file',
    hidden,
    ignored
  }
}

const compareEntries = (left: WorkspaceDirectoryEntry, right: WorkspaceDirectoryEntry) => {
  const leftDirectory = left.kind === 'directory' && left.accessible
  const rightDirectory = right.kind === 'directory' && right.accessible
  if (leftDirectory !== rightDirectory) {
    return leftDirectory ? -1 : 1
  }

  if (left.name < right.name) {
    return -1
  }
  if (left.name > right.name) {
    return 1
  }
  return 0
}

export const listWorkspaceDirectory = async (
  workspaceRoot: string,
  requestedPath: string,
  options: { showIgnored?: boolean } = {}
): Promise<WorkspaceDirectoryListing> => {
  const directoryPath = normalizeWorkspaceRelativePath(requestedPath)

  let resolvedRoot: string
  try {
    resolvedRoot = await realpath(resolve(workspaceRoot))
  } catch (error) {
    throw toDirectoryError(error)
  }

  const requestedTarget = directoryPath
    ? resolve(resolvedRoot, ...directoryPath.split('/'))
    : resolvedRoot

  let resolvedDirectory: string
  try {
    resolvedDirectory = await realpath(requestedTarget)
  } catch (error) {
    throw toDirectoryError(error)
  }

  if (!isPathInsideDirectory(resolvedDirectory, resolvedRoot)) {
    throw new WorkspaceDirectoryError(
      'FORBIDDEN',
      'Workspace directory access is limited to the active workspace root.'
    )
  }

  let directoryStat: Awaited<ReturnType<typeof stat>>
  try {
    directoryStat = await stat(resolvedDirectory)
  } catch (error) {
    throw toDirectoryError(error)
  }

  if (!directoryStat.isDirectory()) {
    throw new WorkspaceDirectoryError('NOT_A_DIRECTORY', 'Workspace path is not a directory.')
  }

  let directoryHandle: Awaited<ReturnType<typeof opendir>>
  try {
    directoryHandle = await opendir(resolvedDirectory)
  } catch (error) {
    throw toDirectoryError(error)
  }

  const entries: WorkspaceDirectoryEntry[] = []
  let truncated = false

  try {
    for await (const directoryEntry of directoryHandle) {
      const entry = await inspectDirectoryEntry({
        root: resolvedRoot,
        directory: resolvedDirectory,
        directoryPath,
        name: directoryEntry.name
      })
      if (entry.kind === 'directory' && entry.ignored && !options.showIgnored) {
        continue
      }

      if (entries.length >= MAX_WORKSPACE_DIRECTORY_ENTRIES) {
        truncated = true
        break
      }

      entries.push(entry)
    }
  } catch (error) {
    throw toDirectoryError(error)
  }

  entries.sort(compareEntries)

  return {
    path: directoryPath,
    entries,
    truncated,
    limit: MAX_WORKSPACE_DIRECTORY_ENTRIES
  }
}

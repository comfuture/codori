import { basename, resolve } from 'node:path'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isPathInsideDirectory } from './attachment-store.js'

export const MAX_LOCAL_FILE_VIEW_BYTES = 1024 * 1024

export type LocalFileReadResult = {
  path: string
  relativePath: string
  name: string
  size: number
  updatedAt: number
  text: string
}

export class LocalFileViewError extends Error {
  readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'NOT_A_FILE' | 'TOO_LARGE' | 'BINARY'

  constructor(
    code: LocalFileViewError['code'],
    message: string
  ) {
    super(message)
    this.name = 'LocalFileViewError'
    this.code = code
  }
}

const hasBinaryContent = (buffer: Buffer) => {
  for (const byte of buffer) {
    if (byte === 0) {
      return true
    }
  }

  return false
}

export const readProjectLocalFile = async (
  projectRoot: string,
  requestedPath: string
): Promise<LocalFileReadResult> => {
  const resolvedProjectRoot = await realpath(resolve(projectRoot))
  const resolvedRequestPath = resolve(requestedPath)

  let resolvedTargetPath: string
  try {
    resolvedTargetPath = await realpath(resolvedRequestPath)
  } catch {
    throw new LocalFileViewError('NOT_FOUND', 'Local file not found.')
  }

  if (!isPathInsideDirectory(resolvedTargetPath, resolvedProjectRoot)) {
    throw new LocalFileViewError('FORBIDDEN', 'Local file access is limited to the active project root.')
  }

  const fileStat = await stat(resolvedTargetPath).catch(() => null)
  if (!fileStat) {
    throw new LocalFileViewError('NOT_FOUND', 'Local file not found.')
  }

  if (!fileStat.isFile()) {
    throw new LocalFileViewError('NOT_A_FILE', 'Only regular files can be previewed.')
  }

  if (fileStat.size > MAX_LOCAL_FILE_VIEW_BYTES) {
    throw new LocalFileViewError(
      'TOO_LARGE',
      `Local file preview is limited to ${Math.floor(MAX_LOCAL_FILE_VIEW_BYTES / 1024)} KB.`
    )
  }

  const buffer = await readFile(resolvedTargetPath)
  if (hasBinaryContent(buffer)) {
    throw new LocalFileViewError('BINARY', 'Binary files are not supported by the local file viewer.')
  }

  return {
    path: resolvedTargetPath,
    relativePath: resolvedTargetPath.slice(resolvedProjectRoot.length).replace(/^[/\\]+/, ''),
    name: basename(resolvedTargetPath),
    size: fileStat.size,
    updatedAt: fileStat.mtimeMs,
    text: buffer.toString('utf8')
  }
}

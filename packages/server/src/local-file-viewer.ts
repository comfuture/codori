import { basename, isAbsolute, relative, resolve } from 'node:path'
import { constants as fsConstants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { lookup as lookupMimeType } from 'mime-types'
import { isPathInsideDirectory } from './attachment-store.js'
import { normalizeWorkspaceRelativePath, WorkspaceDirectoryError } from './workspace-file-explorer.js'

export const MAX_LOCAL_FILE_VIEW_BYTES = 1024 * 1024

type LocalFileReadResultBase = {
  path: string
  relativePath: string
  name: string
  size: number
  updatedAt: number
}

export type LocalFileTextReadResult = LocalFileReadResultBase & {
  kind: 'text'
  text: string
}

export type LocalFileImageReadResult = LocalFileReadResultBase & {
  kind: 'image'
  mediaType: string
  base64: string
}

export type LocalFileReadResult = LocalFileTextReadResult | LocalFileImageReadResult

export class LocalFileViewError extends Error {
  readonly code: 'FORBIDDEN' | 'NOT_FOUND' | 'NOT_A_FILE' | 'TOO_LARGE' | 'BINARY' | 'UNSUPPORTED_MEDIA_TYPE'

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

const readFileWithinLimit = async (fileHandle: Awaited<ReturnType<typeof open>>) => {
  const buffer = Buffer.alloc(MAX_LOCAL_FILE_VIEW_BYTES + 1)
  let offset = 0

  while (offset < buffer.length) {
    const { bytesRead } = await fileHandle.read(
      buffer,
      offset,
      buffer.length - offset,
      null
    )
    if (bytesRead === 0) {
      break
    }
    offset += bytesRead
  }

  return buffer.subarray(0, offset)
}

const SUPPORTED_IMAGE_MEDIA_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml'
])

const getSupportedImageMediaType = (filePath: string) => {
  const inferred = lookupMimeType(filePath)
  if (typeof inferred !== 'string') {
    return null
  }

  const mediaType = inferred.toLowerCase()
  return SUPPORTED_IMAGE_MEDIA_TYPES.has(mediaType)
    ? mediaType
    : null
}

const startsWithBytes = (buffer: Buffer, signature: number[]) =>
  signature.every((byte, index) => buffer[index] === byte)

const hasValidSvgContent = (buffer: Buffer) => {
  if (hasBinaryContent(buffer)) {
    return false
  }

  const text = buffer.toString('utf8').replace(/^\uFEFF/u, '').trimStart()
  return /^<svg(?:\s|>)/iu.test(text) || /^<\?xml[\s\S]*?<svg(?:\s|>)/iu.test(text)
}

const hasValidImageContent = (buffer: Buffer, mediaType: string) => {
  switch (mediaType) {
    case 'image/png':
      return startsWithBytes(buffer, [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
    case 'image/jpeg':
      return startsWithBytes(buffer, [0xFF, 0xD8, 0xFF])
    case 'image/gif':
      return buffer.subarray(0, 6).toString('ascii') === 'GIF87a'
        || buffer.subarray(0, 6).toString('ascii') === 'GIF89a'
    case 'image/webp':
      return buffer.subarray(0, 4).toString('ascii') === 'RIFF'
        && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    case 'image/svg+xml':
      return hasValidSvgContent(buffer)
    default:
      return false
  }
}

export const readProjectLocalFile = async (
  projectRoot: string,
  requestedPath: string
): Promise<LocalFileReadResult> => {
  const resolvedProjectRoot = await realpath(resolve(projectRoot))
  let resolvedRequestPath: string
  if (isAbsolute(requestedPath)) {
    resolvedRequestPath = resolve(requestedPath)
  } else {
    try {
      const relativePath = normalizeWorkspaceRelativePath(requestedPath)
      resolvedRequestPath = relativePath
        ? resolve(resolvedProjectRoot, ...relativePath.split('/'))
        : resolvedProjectRoot
    } catch (error) {
      if (error instanceof WorkspaceDirectoryError) {
        throw new LocalFileViewError('FORBIDDEN', 'Local file access is limited to the active project root.')
      }
      throw error
    }
  }

  let resolvedTargetPath: string
  try {
    resolvedTargetPath = await realpath(resolvedRequestPath)
  } catch {
    throw new LocalFileViewError('NOT_FOUND', 'Local file not found.')
  }

  if (!isPathInsideDirectory(resolvedTargetPath, resolvedProjectRoot)) {
    throw new LocalFileViewError('FORBIDDEN', 'Local file access is limited to the active project root.')
  }

  const fileHandle = await open(
    resolvedTargetPath,
    fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK || 0)
  ).catch(() => null)
  if (!fileHandle) {
    throw new LocalFileViewError('NOT_FOUND', 'Local file not found.')
  }

  let fileStat: Awaited<ReturnType<typeof fileHandle.stat>>
  let buffer: Buffer
  try {
    fileStat = await fileHandle.stat()
    if (!fileStat.isFile()) {
      throw new LocalFileViewError('NOT_A_FILE', 'Only regular files can be previewed.')
    }

    if (fileStat.size > MAX_LOCAL_FILE_VIEW_BYTES) {
      throw new LocalFileViewError(
        'TOO_LARGE',
        `Local file preview is limited to ${Math.floor(MAX_LOCAL_FILE_VIEW_BYTES / 1024)} KB.`
      )
    }

    buffer = await readFileWithinLimit(fileHandle)
    if (buffer.length > MAX_LOCAL_FILE_VIEW_BYTES) {
      throw new LocalFileViewError(
        'TOO_LARGE',
        `Local file preview is limited to ${Math.floor(MAX_LOCAL_FILE_VIEW_BYTES / 1024)} KB.`
      )
    }
  } finally {
    await fileHandle.close()
  }
  const baseFile = {
    path: resolvedTargetPath,
    relativePath: relative(resolvedProjectRoot, resolvedTargetPath),
    name: basename(resolvedTargetPath),
    size: fileStat.size,
    updatedAt: fileStat.mtimeMs
  }

  const imageMediaType = getSupportedImageMediaType(resolvedTargetPath)
  if (imageMediaType) {
    if (!hasValidImageContent(buffer, imageMediaType)) {
      throw new LocalFileViewError(
        'UNSUPPORTED_MEDIA_TYPE',
        'Local image preview is only available for valid PNG, JPEG, GIF, WebP, or SVG files.'
      )
    }

    return {
      ...baseFile,
      kind: 'image',
      mediaType: imageMediaType,
      base64: buffer.toString('base64')
    }
  }

  if (hasBinaryContent(buffer)) {
    throw new LocalFileViewError('BINARY', 'Binary files are not supported by the local file viewer.')
  }

  return {
    ...baseFile,
    kind: 'text',
    text: buffer.toString('utf8')
  }
}

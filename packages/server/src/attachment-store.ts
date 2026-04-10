import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { pipeline } from 'node:stream/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { resolveCodoriHome } from './config.js'

export type PersistedAttachment = {
  filename: string
  mediaType: string | null
  path: string
}

type AttachmentMetadata = {
  mediaType: string | null
}

const hashSegment = (value: string) =>
  createHash('sha256').update(value).digest('hex').slice(0, 16)

const sanitizeFilename = (value: string) => {
  const normalized = basename(value).trim()
  return normalized || 'attachment'
}

const pathExists = async (value: string) => {
  try {
    await access(value)
    return true
  } catch {
    return false
  }
}

const ensureUniqueFilePath = async (directory: string, filename: string) => {
  const extension = extname(filename)
  const base = extension ? filename.slice(0, -extension.length) : filename
  let candidate = join(directory, filename)
  let index = 1

  while (await pathExists(candidate)) {
    candidate = join(directory, `${base}-${index}${extension}`)
    index += 1
  }

  return candidate
}

const attachmentMetadataPath = (filePath: string) => `${filePath}.metadata.json`

export const resolveAttachmentsRootDir = (rootDir?: string | null) =>
  resolve(rootDir ?? join(resolveCodoriHome(os.homedir()), 'attachments'))

export const resolveProjectAttachmentsDir = (
  projectPath: string,
  rootDir?: string | null
) => join(resolveAttachmentsRootDir(rootDir), hashSegment(projectPath))

export const resolveThreadAttachmentsDir = (
  projectPath: string,
  threadId: string,
  rootDir?: string | null
) => join(resolveProjectAttachmentsDir(projectPath, rootDir), hashSegment(threadId))

export const isPathInsideDirectory = (targetPath: string, directory: string) => {
  const relativePath = relative(directory, targetPath)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

export const writeAttachmentMetadata = async (filePath: string, metadata: AttachmentMetadata) => {
  await writeFile(
    attachmentMetadataPath(filePath),
    `${JSON.stringify(metadata, null, 2)}\n`,
    'utf8'
  )
}

export const readAttachmentMetadata = async (filePath: string): Promise<AttachmentMetadata | null> => {
  try {
    const source = await readFile(attachmentMetadataPath(filePath), 'utf8')
    const parsed: unknown = JSON.parse(source)
    if (
      typeof parsed === 'object'
      && parsed !== null
      && 'mediaType' in parsed
      && (typeof parsed.mediaType === 'string' || parsed.mediaType === null)
    ) {
      return {
        mediaType: parsed.mediaType
      }
    }

    return null
  } catch {
    return null
  }
}

export const createThreadAttachmentTarget = async (input: {
  projectPath: string
  threadId: string
  filename: string
  rootDir?: string | null
}) => {
  const directory = resolveThreadAttachmentsDir(input.projectPath, input.threadId, input.rootDir)
  await mkdir(directory, { recursive: true })
  const filename = sanitizeFilename(input.filename)
  return await ensureUniqueFilePath(directory, filename)
}

export const persistThreadAttachmentStream = async (input: {
  projectPath: string
  threadId: string
  filename: string
  mediaType: string | null
  stream: NodeJS.ReadableStream
  rootDir?: string | null
}): Promise<PersistedAttachment> => {
  const filePath = await createThreadAttachmentTarget(input)
  await pipeline(input.stream, createWriteStream(filePath))
  await writeAttachmentMetadata(filePath, {
    mediaType: input.mediaType
  })

  return {
    filename: basename(filePath),
    mediaType: input.mediaType,
    path: filePath
  }
}

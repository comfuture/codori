import { createHash } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { resolveCodoriHome } from './config.js'

export type PersistedAttachment = {
  filename: string
  mediaType: string | null
  path: string
}

type AttachmentFileInput = {
  filename: string
  mediaType: string | null
  data: Buffer
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

export const persistThreadAttachments = async (input: {
  projectPath: string
  threadId: string
  files: AttachmentFileInput[]
  rootDir?: string | null
}): Promise<PersistedAttachment[]> => {
  const directory = resolveThreadAttachmentsDir(input.projectPath, input.threadId, input.rootDir)
  await mkdir(directory, { recursive: true })

  const persisted: PersistedAttachment[] = []
  for (const file of input.files) {
    const filename = sanitizeFilename(file.filename)
    const filePath = await ensureUniqueFilePath(directory, filename)
    await writeFile(filePath, file.data)
    persisted.push({
      filename: basename(filePath),
      mediaType: file.mediaType,
      path: filePath
    })
  }

  return persisted
}

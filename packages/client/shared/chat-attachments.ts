import type { CodexUserInput } from './codex-rpc'
import { encodeProjectIdSegment } from './codori'
import { resolveApiUrl } from './network'

export const MAX_ATTACHMENTS_PER_MESSAGE = 8
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type FileLike = {
  name: string
  size: number
  type: string
}

export type AttachmentValidationIssue = {
  code: 'tooMany' | 'unsupportedType' | 'tooLarge'
  fileName: string
  message: string
}

export type PersistedProjectAttachment = {
  filename: string
  mediaType: string | null
  path: string
}

export type ProjectAttachmentUploadResponse = {
  threadId: string
  files: PersistedProjectAttachment[]
}

export const isSupportedAttachmentType = (mediaType: string) =>
  mediaType.toLowerCase().startsWith('image/')

export const validateAttachmentSelection = <T extends FileLike>(
  files: T[],
  existingCount: number
) => {
  const issues: AttachmentValidationIssue[] = []
  const accepted: T[] = []

  for (const file of files) {
    if (existingCount + accepted.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
      issues.push({
        code: 'tooMany',
        fileName: file.name,
        message: `You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} images per message.`
      })
      continue
    }

    const mediaType = file.type || 'application/octet-stream'
    if (!isSupportedAttachmentType(mediaType)) {
      issues.push({
        code: 'unsupportedType',
        fileName: file.name,
        message: 'Only image attachments are currently supported.'
      })
      continue
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      issues.push({
        code: 'tooLarge',
        fileName: file.name,
        message: `Each image must be ${Math.floor(MAX_ATTACHMENT_BYTES / (1024 * 1024))} MB or smaller.`
      })
      continue
    }

    accepted.push(file)
  }

  return {
    accepted,
    issues
  }
}

export const buildTurnStartInput = (
  text: string,
  attachments: Array<{ path: string }>
): CodexUserInput[] => {
  const input: CodexUserInput[] = []
  const trimmedText = text.trim()

  if (trimmedText) {
    input.push({
      type: 'text',
      text: trimmedText,
      text_elements: []
    })
  }

  for (const attachment of attachments) {
    input.push({
      type: 'localImage',
      path: attachment.path
    })
  }

  return input
}

export const resolveAttachmentPreviewUrl = (input: {
  projectId: string
  path: string
  configuredBase?: string | null
}) => {
  const query = new URLSearchParams({
    path: input.path
  })

  return resolveApiUrl(
    `/projects/${encodeProjectIdSegment(input.projectId)}/attachments/file?${query.toString()}`,
    input.configuredBase
  )
}

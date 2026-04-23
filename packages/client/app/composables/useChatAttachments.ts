import { ref } from 'vue'
import { useRuntimeConfig } from '#imports'
import { $fetch } from 'ofetch'
import {
  resolveAttachmentUploadUrl,
  type WorkspaceAttachmentScope,
  type ProjectAttachmentUploadResponse,
  validateAttachmentSelection
} from '~~/shared/chat-attachments'

export type DraftAttachment = {
  id: string
  file: File
  name: string
  size: number
  mediaType: string
  previewUrl: string
}

const createAttachmentId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`

export const useChatAttachments = (workspace: string | WorkspaceAttachmentScope) => {
  const runtimeConfig = useRuntimeConfig()
  const attachments = ref<DraftAttachment[]>([])
  const isDragging = ref(false)
  const isUploading = ref(false)
  const error = ref<string | null>(null)
  const fileInput = ref<HTMLInputElement | null>(null)
  const dragDepth = ref(0)

  const revokePreviewUrl = (attachment: Pick<DraftAttachment, 'previewUrl'>) => {
    if (import.meta.client) {
      URL.revokeObjectURL(attachment.previewUrl)
    }
  }

  const addFiles = (fileList?: FileList | File[] | null) => {
    const files = Array.from(fileList ?? [])
    if (!files.length) {
      return
    }

    const { accepted, issues } = validateAttachmentSelection(files, attachments.value.length)
    error.value = issues[0]?.message ?? null

    if (!accepted.length) {
      return
    }

    attachments.value = [
      ...attachments.value,
      ...accepted.map(file => ({
        id: createAttachmentId(),
        file,
        name: file.name,
        size: file.size,
        mediaType: file.type || 'application/octet-stream',
        previewUrl: URL.createObjectURL(file)
      }))
    ]
  }

  const removeAttachment = (id: string) => {
    const existing = attachments.value.find(attachment => attachment.id === id)
    if (existing) {
      revokePreviewUrl(existing)
    }
    attachments.value = attachments.value.filter(attachment => attachment.id !== id)
    if (!attachments.value.length) {
      error.value = null
    }
  }

  const replaceAttachments = (next: DraftAttachment[]) => {
    attachments.value = next
  }

  const clearAttachments = (options: { revoke?: boolean } = {}) => {
    if (options.revoke !== false) {
      for (const attachment of attachments.value) {
        revokePreviewUrl(attachment)
      }
    }

    attachments.value = []
    error.value = null
  }

  const discardSnapshot = (snapshot: DraftAttachment[]) => {
    for (const attachment of snapshot) {
      revokePreviewUrl(attachment)
    }
  }

  const openFilePicker = () => {
    fileInput.value?.click()
  }

  const onFileInputChange = (event: Event) => {
    const target = event.target as HTMLInputElement | null
    addFiles(target?.files ?? null)
    if (target) {
      target.value = ''
    }
  }

  const onPaste = (event: ClipboardEvent) => {
    const files = Array.from(event.clipboardData?.items ?? [])
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter((file): file is File => Boolean(file))

    if (!files.length) {
      return
    }

    event.preventDefault()
    addFiles(files)
  }

  const onDragEnter = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) {
      return
    }

    event.preventDefault()
    dragDepth.value += 1
    isDragging.value = true
  }

  const onDragOver = (event: DragEvent) => {
    if (!event.dataTransfer?.types.includes('Files')) {
      return
    }

    event.preventDefault()
  }

  const onDragLeave = () => {
    dragDepth.value = Math.max(0, dragDepth.value - 1)
    if (dragDepth.value === 0) {
      isDragging.value = false
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    addFiles(event.dataTransfer?.files ?? null)
    dragDepth.value = 0
    isDragging.value = false
  }

  const uploadAttachments = async (
    threadId: string,
    selectedAttachments: DraftAttachment[]
  ) => {
    if (!selectedAttachments.length) {
      return []
    }

    const formData = new FormData()
    formData.append('threadId', threadId)
    for (const attachment of selectedAttachments) {
      formData.append('file', attachment.file, attachment.name)
    }

    isUploading.value = true
    try {
      const response = await $fetch<ProjectAttachmentUploadResponse>(
        resolveAttachmentUploadUrl({
          workspace: typeof workspace === 'string'
            ? { kind: 'project', id: workspace }
            : workspace,
          configuredBase: String(runtimeConfig.public.serverBase ?? '')
        }),
        {
          method: 'POST',
          body: formData
        }
      )

      return response.files
    } finally {
      isUploading.value = false
    }
  }

  return {
    attachments,
    isDragging,
    isUploading,
    error,
    fileInput,
    addFiles,
    removeAttachment,
    replaceAttachments,
    clearAttachments,
    discardSnapshot,
    openFilePicker,
    onFileInputChange,
    onPaste,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    uploadAttachments
  }
}

<script setup lang="ts">
import { computed } from 'vue'
import { useRuntimeConfig } from '#imports'
import { resolveAttachmentPreviewUrl, type WorkspaceAttachmentScope } from '~~/shared/chat-attachments'
import type { ChatPart } from '~~/shared/codex-chat'

const props = defineProps<{
  projectId?: string
  workspace?: WorkspaceAttachmentScope
  part?: Extract<ChatPart, { type: 'attachment' }> | null
}>()

const runtimeConfig = useRuntimeConfig()
const workspaceScope = computed<WorkspaceAttachmentScope | null>(() =>
  props.workspace ?? (props.projectId ? { kind: 'project', id: props.projectId } : null)
)
const isAudio = computed(() => props.part?.attachment.kind === 'audio')

const previewUrl = computed(() => {
  const attachment = props.part?.attachment
  const workspace = workspaceScope.value
  if (!attachment) {
    return null
  }

  if (attachment.url) {
    return attachment.url
  }

  if (!attachment.localPath || !workspace) {
    return null
  }

  return resolveAttachmentPreviewUrl({
    workspace,
    path: attachment.localPath,
    configuredBase: String(runtimeConfig.public.serverBase ?? '')
  })
})
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-default bg-elevated/30">
    <audio
      v-if="isAudio && previewUrl"
      :src="previewUrl"
      controls
      preload="metadata"
      class="w-full px-3 pt-3"
    />
    <img
      v-else-if="previewUrl"
      :src="previewUrl"
      :alt="part?.attachment.name"
      class="max-h-80 w-full object-cover"
      loading="lazy"
    >
    <div class="flex items-center gap-3 px-3 py-2 text-sm text-toned">
      <UIcon
        :name="isAudio ? 'i-lucide-audio-lines' : 'i-lucide-image'"
        class="size-4 text-primary"
      />
      <span class="truncate">{{ part?.attachment.name }}</span>
    </div>
  </div>
</template>

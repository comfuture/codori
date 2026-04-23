<script setup lang="ts">
import { computed } from 'vue'
import { useRuntimeConfig } from '#imports'
import { resolveAttachmentPreviewUrl, type WorkspaceAttachmentScope } from '~~/shared/chat-attachments'

const props = defineProps<{
  projectId?: string
  workspace?: WorkspaceAttachmentScope
  part?: {
    type: 'attachment'
    attachment: {
      kind: 'image'
      name: string
      mediaType: string
      url?: string | null
      localPath?: string | null
    }
  } | null
}>()

const runtimeConfig = useRuntimeConfig()
const workspaceScope = computed<WorkspaceAttachmentScope | null>(() =>
  props.workspace ?? (props.projectId ? { kind: 'project', id: props.projectId } : null)
)

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
    <img
      v-if="previewUrl"
      :src="previewUrl"
      :alt="part?.attachment.name"
      class="max-h-80 w-full object-cover"
      loading="lazy"
    >
    <div class="flex items-center gap-3 px-3 py-2 text-sm text-toned">
      <UIcon
        name="i-lucide-image"
        class="size-4 text-primary"
      />
      <span class="truncate">{{ part?.attachment.name }}</span>
    </div>
  </div>
</template>

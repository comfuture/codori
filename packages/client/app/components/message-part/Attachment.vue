<script setup lang="ts">
import { computed } from 'vue'
import { useRuntimeConfig } from '#imports'
import { resolveAttachmentPreviewUrl } from '~~/shared/chat-attachments'

const props = defineProps<{
  projectId?: string
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

const previewUrl = computed(() => {
  const attachment = props.part?.attachment
  if (!attachment) {
    return null
  }

  if (attachment.url) {
    return attachment.url
  }

  if (!attachment.localPath || !props.projectId) {
    return null
  }

  return resolveAttachmentPreviewUrl({
    projectId: props.projectId,
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

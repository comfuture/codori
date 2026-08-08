<script setup lang="ts">
import MessagePartText from './Text.vue'
import type { WorkspaceAttachmentScope } from '~~/shared/chat-attachments'

defineProps<{
  projectId?: string
  workspace?: WorkspaceAttachmentScope
  workspaceRootPath?: string | null
  part?: {
    type: 'plan'
    text: string
    state?: 'done' | 'streaming'
  } | null
}>()
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-default bg-default">
    <div class="flex items-center gap-2 border-b border-default px-3 py-2 text-xs font-medium text-muted">
      <UIcon
        name="i-lucide-list-checks"
        class="size-3.5"
      />
      <span>Plan</span>
    </div>

    <div class="px-3 py-3">
      <MessagePartText
        role="assistant"
        :project-id="projectId"
        :workspace="workspace"
        :workspace-root-path="workspaceRootPath"
        :part="part ? { type: 'text', text: part.text, state: part.state } : null"
      />
    </div>
  </section>
</template>

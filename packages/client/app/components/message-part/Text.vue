<script setup lang="ts">
import { Comark } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import math, { Math as ComarkMath } from '@comark/vue/plugins/math'
import mermaid from '@comark/vue/plugins/mermaid'
import { computed } from 'vue'
import { ChatMarkdownMermaid } from './ChatMarkdownMermaid'
import ReviewPriorityBadge from './ReviewPriorityBadge.vue'
import { createChatMarkdownLocalFileLink } from './createChatMarkdownLocalFileLink'
import { reviewPriorityBadgePlugin } from '../../utils/review-priority-badge'
import type { WorkspaceLocalFileScope } from '../../../shared/local-files'

const props = defineProps<{
  role?: 'user' | 'assistant' | 'system'
  projectId?: string | null
  workspace?: WorkspaceLocalFileScope | null
  workspaceRootPath?: string | null
  part?: {
    type: 'text'
    text: string
    state?: 'done' | 'streaming'
  } | null
}>()

const ChatMarkdownLocalFileLink = createChatMarkdownLocalFileLink(() => ({
  projectId: props.projectId ?? null,
  workspace: props.workspace ?? null,
  workspaceRootPath: props.workspaceRootPath ?? null
}))

const components = {
  a: ChatMarkdownLocalFileLink,
  math: ComarkMath,
  mermaid: ChatMarkdownMermaid,
  'review-priority-badge': ReviewPriorityBadge
}

const plugins = [
  math(),
  mermaid(),
  reviewPriorityBadgePlugin(),
  highlight({ preStyles: false })
]
const isStreaming = computed(() => props.part?.state === 'streaming')
const markdownClass = computed(() =>
  props.role === 'user'
    ? 'cd-markdown cd-markdown-user'
    : 'cd-markdown'
)
</script>

<template>
  <Suspense>
    <Comark
      :class="markdownClass"
      :markdown="part?.text ?? ''"
      :streaming="isStreaming"
      :components="components"
      :plugins="plugins"
      caret
    />
  </Suspense>
</template>

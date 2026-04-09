<script setup lang="ts">
import { computed } from 'vue'
import type { CodoriFileChangeItem } from '~~/shared/codex-chat.js'
import { useChatToolState } from './use-chat-tool-state.js'

const props = defineProps<{
  item: CodoriFileChangeItem
}>()

const filePreview = computed(() => {
  const [firstChange] = props.item.changes
  if (!firstChange?.path) {
    return 'file changes'
  }

  if (props.item.changes.length === 1) {
    return firstChange.path
  }

  return `${firstChange.path} +${props.item.changes.length - 1} more`
})

const title = computed(() => {
  switch (props.item.status) {
    case 'inProgress':
      return 'Applying file changes'
    case 'failed':
      return 'File change failed'
    default:
      return 'File changes'
  }
})

const icon = computed(() =>
  props.item.status === 'failed' ? 'i-lucide-triangle-alert' : 'i-lucide-file-pen-line'
)
const { open, isLoading, isStreaming } = useChatToolState(() => props.item.status, props.item.status !== 'completed')
</script>

<template>
  <UChatTool
    :text="title"
    :suffix="filePreview"
    :icon="icon"
    :loading="isLoading"
    :streaming="isStreaming"
    variant="card"
    :open="open"
    :default-open="item.status !== 'completed'"
    @update:open="open = $event"
  >
    <div class="space-y-3">
      <pre
        v-if="item.liveOutput"
        class="overflow-x-auto rounded-xl border border-default/70 bg-elevated/40 px-3 py-3 text-xs leading-6 text-toned"
      >{{ item.liveOutput }}</pre>

      <ul class="space-y-3">
        <li
          v-for="(change, index) in item.changes"
          :key="`${item.id}-${change.path}-${index}`"
          class="space-y-2 rounded-xl border border-default/70 bg-elevated/20 px-3 py-3"
        >
          <div class="flex items-center gap-2 text-xs font-medium text-muted">
            <UIcon
              :name="change.kind === 'add' ? 'i-lucide-plus' : change.kind === 'delete' ? 'i-lucide-minus' : 'i-lucide-pencil'"
              class="size-3.5"
            />
            <span class="font-mono text-toned">{{ change.path }}</span>
          </div>
          <pre
            v-if="change.diff"
            class="overflow-x-auto rounded-lg bg-default px-3 py-3 text-[11px] leading-5 text-toned"
          >{{ change.diff }}</pre>
        </li>
      </ul>
    </div>
  </UChatTool>
</template>

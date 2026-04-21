<script setup lang="ts">
import { computed } from 'vue'
import type { FileChangeItem } from '~~/shared/codex-chat'
import type { PatchChangeKind } from '~~/shared/generated/codex-app-server/v2/PatchChangeKind'
import { useChatToolState } from './use-chat-tool-state'

const props = defineProps<{
  item: FileChangeItem
  liveOutput?: string | null
}>()

const changes = computed(() => props.item.changes ?? [])

const hasDiff = (diff?: string | null) => typeof diff === 'string' && diff.trim().length > 0

const filePreview = computed(() => {
  const [firstChange] = changes.value
  if (!firstChange?.path) {
    return 'file changes'
  }

  if (changes.value.length === 1) {
    return firstChange.path
  }

  return `${firstChange.path} +${changes.value.length - 1} more`
})

const title = computed(() => {
  const hasChanges = changes.value.length > 0
  const deletedOnly = hasChanges && changes.value.every(change => change.kind.type === 'delete')

  switch (props.item.status) {
    case 'inProgress':
      return 'Editing..'
    case 'failed':
      return 'Edit failed'
    default:
      return deletedOnly ? 'Deleted' : 'Edited'
  }
})

const icon = computed(() =>
  props.item.status === 'failed' ? 'i-lucide-triangle-alert' : 'i-lucide-file-pen-line'
)

const changeKindIcon = (kind?: PatchChangeKind) => {
  switch (kind?.type) {
    case 'add':
      return 'i-lucide-plus'
    case 'delete':
      return 'i-lucide-minus'
    case 'update':
      return 'i-lucide-pencil'
    default:
      return 'i-lucide-file'
  }
}

const changeKindClass = (kind?: PatchChangeKind) => {
  switch (kind?.type) {
    case 'add':
      return 'text-success'
    case 'delete':
      return 'text-error'
    case 'update':
      return 'text-warning'
    default:
      return 'text-muted'
  }
}

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
        v-if="liveOutput"
        class="overflow-x-auto rounded-xl border border-default/70 bg-elevated/40 px-3 py-3 text-xs leading-6 text-toned"
      >{{ liveOutput }}</pre>

      <ul class="space-y-3">
        <li
          v-for="(change, index) in changes"
          :key="`${item.id}-${change.path}-${index}`"
          class="space-y-2 rounded-xl border border-default/70 bg-elevated/20 px-3 py-3"
        >
          <div class="flex items-center gap-2 text-xs font-medium text-muted">
            <UIcon
              :name="changeKindIcon(change.kind)"
              class="size-3.5"
              :class="changeKindClass(change.kind)"
            />
            <span class="font-mono text-toned">{{ change.path }}</span>
          </div>
          <MessageItemUnifiedDiffViewer
            v-if="hasDiff(change.diff)"
            :diff="change.diff ?? ''"
          />
        </li>
      </ul>
    </div>
  </UChatTool>
</template>

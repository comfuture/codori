<script setup lang="ts">
import { computed } from 'vue'
import type { CodoriCommandExecutionItem } from '~~/shared/codex-chat.js'
import CdMessageItemChatTool from './chat-tool.vue'

const props = defineProps<{
  item: CodoriCommandExecutionItem
}>()

const title = computed(() => {
  switch (props.item.status) {
    case 'inProgress':
      return 'Running command'
    case 'failed':
      return 'Command failed'
    default:
      return 'Command'
  }
})

const output = computed(() => props.item.aggregatedOutput?.trim() ?? '')
</script>

<template>
  <CdMessageItemChatTool
    :text="title"
    :suffix="item.command"
    icon="i-lucide-terminal"
    :status="item.status"
    variant="card"
    :default-open="item.status !== 'completed'"
  >
    <div class="space-y-3">
      <pre
        v-if="output"
        class="overflow-x-auto rounded-xl border border-default/70 bg-elevated/40 px-3 py-3 text-xs leading-6 text-toned"
      >{{ output }}</pre>
      <p
        v-else
        class="text-xs text-muted"
      >
        Waiting for output.
      </p>
      <p
        v-if="item.exitCode !== null"
        class="text-xs font-medium text-muted"
      >
        Exit code {{ item.exitCode }}
      </p>
    </div>
  </CdMessageItemChatTool>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { CodoriDynamicToolCallItem } from '~~/shared/codex-chat.js'
import CdMessageItemChatTool from './chat-tool.vue'

const props = defineProps<{
  item: CodoriDynamicToolCallItem
}>()

const inputSummary = computed(() =>
  props.item.contentItems?.map((entry) =>
    entry.type === 'inputText' ? entry.text : `[image] ${entry.imageUrl}`
  ).join('\n\n') ?? ''
)

const title = computed(() => {
  switch (props.item.status) {
    case 'inProgress':
      return 'Running internal tool'
    case 'failed':
      return 'Internal tool failed'
    default:
      return 'Internal tool'
  }
})
</script>

<template>
  <CdMessageItemChatTool
    :text="title"
    :suffix="item.tool"
    icon="i-lucide-wrench"
    :status="item.status"
    variant="card"
    :default-open="item.status !== 'completed'"
  >
    <div class="space-y-3">
      <pre
        v-if="inputSummary"
        class="overflow-x-auto rounded-xl border border-default/70 bg-elevated/30 px-3 py-3 text-xs leading-6 text-toned"
      >{{ inputSummary }}</pre>

      <pre
        v-if="item.arguments != null"
        class="overflow-x-auto rounded-xl border border-default/70 bg-elevated/30 px-3 py-3 text-xs leading-6 text-toned"
      >{{ JSON.stringify(item.arguments, null, 2) }}</pre>

      <p
        v-if="item.success !== null"
        class="text-xs font-medium"
        :class="item.success ? 'text-success' : 'text-error'"
      >
        {{ item.success ? 'Completed successfully.' : 'Reported failure.' }}
      </p>
    </div>
  </CdMessageItemChatTool>
</template>

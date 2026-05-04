<script setup lang="ts">
import { ref } from 'vue'
import {
  ITEM_PART,
  TOOL_GROUP_PART,
  type ChatPart
} from '~~/shared/codex-chat'
import MessagePartItem from './Item'

const props = defineProps<{
  part: Extract<ChatPart, { type: typeof TOOL_GROUP_PART }>
}>()

const open = ref(false)

const childItemParts = props.part.data.messages.flatMap(message =>
  message.parts.filter((part): part is Extract<ChatPart, { type: typeof ITEM_PART }> =>
    part.type === ITEM_PART
  )
)
</script>

<template>
  <UChatTool
    :text="part.data.summary"
    :suffix="part.data.details"
    icon="i-lucide-list-collapse"
    variant="card"
    chevron="leading"
    :open="open"
    :default-open="false"
    @update:open="open = $event"
  >
    <div class="space-y-3">
      <MessagePartItem
        v-for="childPart in childItemParts"
        :key="childPart.data.item.id"
        :part="childPart"
      />
    </div>
  </UChatTool>
</template>

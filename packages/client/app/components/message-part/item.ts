import { defineComponent, h, type PropType } from 'vue'
import {
  ITEM_PART,
  type ChatPart,
  type ItemData
} from '~~/shared/codex-chat.js'
import MessageItemCommandExecution from '../message-item/CommandExecution.vue'
import MessageItemContextCompaction from '../message-item/ContextCompaction.vue'
import MessageItemDynamicToolCall from '../message-item/DynamicToolCall.vue'
import MessageItemFileChange from '../message-item/FileChange.vue'
import MessageItemMcpToolCall from '../message-item/McpToolCall.vue'
import MessageItemSubagentActivity from '../message-item/SubagentActivity.vue'
import MessageItemWebSearch from '../message-item/WebSearch.vue'

export default defineComponent({
  name: 'MessagePartItem',
  props: {
    part: {
      type: Object as PropType<ChatPart | null>,
      default: null
    }
  },
  setup(props) {
    return () => {
      if (!props.part || props.part.type !== ITEM_PART) {
        return null
      }

      const itemData = props.part.data as ItemData
      switch (itemData.kind) {
        case 'command_execution':
          return h(MessageItemCommandExecution, { item: itemData.item })
        case 'file_change':
          return h(MessageItemFileChange, { item: itemData.item })
        case 'mcp_tool_call':
          return h(MessageItemMcpToolCall, { item: itemData.item })
        case 'dynamic_tool_call':
          return h(MessageItemDynamicToolCall, { item: itemData.item })
        case 'subagent_activity':
          return h(MessageItemSubagentActivity, { item: itemData.item })
        case 'web_search':
          return h(MessageItemWebSearch, { item: itemData.item })
        case 'context_compaction':
          return h(MessageItemContextCompaction)
        default:
          return null
      }
    }
  }
})

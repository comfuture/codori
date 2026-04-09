import { defineComponent, h, type PropType } from 'vue'
import {
  CODORI_ITEM_PART,
  type CodoriChatPart,
  type CodoriItemData
} from '~~/shared/codex-chat.js'
import CdMessageItemCommandExecution from '../message-item/command-execution.vue'
import CdMessageItemContextCompaction from '../message-item/context-compaction.vue'
import CdMessageItemDynamicToolCall from '../message-item/dynamic-tool-call.vue'
import CdMessageItemFileChange from '../message-item/file-change.vue'
import CdMessageItemMcpToolCall from '../message-item/mcp-tool-call.vue'
import CdMessageItemWebSearch from '../message-item/web-search.vue'

export default defineComponent({
  name: 'CdMessagePartItem',
  props: {
    part: {
      type: Object as PropType<CodoriChatPart | null>,
      default: null
    }
  },
  setup(props) {
    return () => {
      if (!props.part || props.part.type !== CODORI_ITEM_PART) {
        return null
      }

      const itemData = props.part.data as CodoriItemData
      switch (itemData.kind) {
        case 'command_execution':
          return h(CdMessageItemCommandExecution, { item: itemData.item })
        case 'file_change':
          return h(CdMessageItemFileChange, { item: itemData.item })
        case 'mcp_tool_call':
          return h(CdMessageItemMcpToolCall, { item: itemData.item })
        case 'dynamic_tool_call':
          return h(CdMessageItemDynamicToolCall, { item: itemData.item })
        case 'web_search':
          return h(CdMessageItemWebSearch, { item: itemData.item })
        case 'context_compaction':
          return h(CdMessageItemContextCompaction)
        default:
          return null
      }
    }
  }
})

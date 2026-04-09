import { defineComponent, h, resolveComponent, type PropType } from 'vue'
import { EVENT_PART, ITEM_PART, type ChatMessage, type ChatPart } from '~~/shared/codex-chat.js'
import MessagePartEvent from './message-part/Event.vue'
import MessagePartItem from './message-part/Item.js'
import MessagePartText from './message-part/Text.vue'

export default defineComponent({
  name: 'MessagePartRenderer',
  props: {
    message: {
      type: Object as PropType<ChatMessage | null>,
      default: null
    },
    part: {
      type: Object as PropType<ChatPart | null>,
      default: null
    }
  },
  setup(props) {
    const chatReasoning = resolveComponent('UChatReasoning')

    return () => {
      if (!props.part) {
        return null
      }

      switch (props.part.type) {
        case 'text':
          return h(MessagePartText, {
            role: props.message?.role,
            part: props.part
          })
        case 'reasoning':
          return h(chatReasoning, {
            icon: 'i-lucide-brain',
            text: [...props.part.summary, ...props.part.content].join('\n\n').trim(),
            streaming: props.part.state === 'streaming',
            defaultOpen: props.part.state === 'streaming',
            autoCloseDelay: 600
          })
        case EVENT_PART:
          return h(MessagePartEvent, {
            part: props.part
          })
        case ITEM_PART:
          return h(MessagePartItem, {
            part: props.part
          })
        default:
          return h('pre', {
            class: 'overflow-x-auto rounded-lg border border-dashed border-default bg-elevated/40 p-3 text-xs text-muted'
          }, JSON.stringify(props.part, null, 2))
      }
    }
  }
})

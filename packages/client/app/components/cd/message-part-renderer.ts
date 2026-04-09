import { defineComponent, h, resolveComponent, type PropType } from 'vue'
import type { CodoriChatMessage, CodoriChatPart } from '~~/shared/codex-chat.js'
import CdMessagePartEvent from './message-part/event.vue'
import CdMessagePartItem from './message-part/item.js'
import CdMessagePartText from './message-part/text.vue'

export default defineComponent({
  name: 'CdMessagePartRenderer',
  props: {
    message: {
      type: Object as PropType<CodoriChatMessage | null>,
      default: null
    },
    part: {
      type: Object as PropType<CodoriChatPart | null>,
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
          return h(CdMessagePartText, {
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
        case 'data-codori-event':
          return h(CdMessagePartEvent, {
            part: props.part
          })
        case 'data-codori-item':
          return h(CdMessagePartItem, {
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

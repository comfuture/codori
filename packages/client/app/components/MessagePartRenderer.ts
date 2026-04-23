import { defineComponent, h, type PropType } from 'vue'
import { UChatReasoning } from '#components'
import { EVENT_PART, ITEM_PART, type ChatMessage, type ChatPart } from '~~/shared/codex-chat'
import type { WorkspaceAttachmentScope } from '~~/shared/chat-attachments'
import MessagePartAttachment from './message-part/Attachment.vue'
import MessagePartEvent from './message-part/Event.vue'
import MessagePartItem from './message-part/Item'
import MessagePartPlan from './message-part/Plan.vue'
import MessagePartText from './message-part/Text.vue'

export default defineComponent({
  name: 'MessagePartRenderer',
  props: {
    message: {
      type: Object as PropType<ChatMessage | null>,
      default: null
    },
    projectId: {
      type: String as PropType<string | undefined>,
      default: undefined
    },
    workspace: {
      type: Object as PropType<WorkspaceAttachmentScope | undefined>,
      default: undefined
    },
    workspaceRootPath: {
      type: String as PropType<string | null | undefined>,
      default: undefined
    },
    part: {
      type: Object as PropType<ChatPart | null>,
      default: null
    }
  },
  setup(props) {
    return () => {
      if (!props.part) {
        return null
      }

      switch (props.part.type) {
        case 'text':
          return h(MessagePartText, {
            role: props.message?.role,
            projectId: props.projectId,
            workspace: props.workspace,
            workspaceRootPath: props.workspaceRootPath,
            part: props.part
          })
        case 'plan':
          return h(MessagePartPlan, {
            part: props.part
          })
        case 'reasoning':
          return h(UChatReasoning, {
            icon: 'i-lucide-brain',
            text: [...props.part.summary, ...props.part.content].join('\n\n').trim(),
            streaming: props.part.state === 'streaming',
            defaultOpen: props.part.state === 'streaming',
            autoCloseDelay: 600
          })
        case 'attachment':
          return h(MessagePartAttachment, {
            projectId: props.projectId,
            workspace: props.workspace,
            part: props.part
          })
        case EVENT_PART:
          return h(MessagePartEvent, {
            part: props.part
          })
        case ITEM_PART:
          return h(MessagePartItem, {
            part: props.part,
            messagePending: props.message?.pending ?? false
          })
        default:
          return h('pre', {
            class: 'overflow-x-auto rounded-lg border border-dashed border-default bg-elevated/40 p-3 text-xs text-muted'
          }, JSON.stringify(props.part, null, 2))
      }
    }
  }
})

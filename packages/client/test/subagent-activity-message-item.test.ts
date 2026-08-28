// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import SubagentActivity from '../app/components/message-item/SubagentActivity.vue'
import type { SubagentActivityItem } from '../shared/codex-chat'

const ChatToolStub = defineComponent({
  name: 'UChatTool',
  props: {
    text: {
      type: String,
      default: ''
    },
    icon: {
      type: String,
      default: ''
    },
    suffix: {
      type: String,
      default: ''
    },
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:open'],
  template: '<section data-testid="tool"><slot /></section>'
})

const makeItem = (
  tool: SubagentActivityItem['tool'],
  status: SubagentActivityItem['status'] = 'completed'
): SubagentActivityItem => ({
  type: 'collabAgentToolCall',
  id: `tool-${tool}`,
  tool,
  status,
  senderThreadId: 'sender-thread',
  receiverThreadIds: ['receiver-thread'],
  prompt: null,
  model: null,
  reasoningEffort: null,
  agentsStates: {}
})

const mountItem = (item: SubagentActivityItem) => mount(SubagentActivity, {
  props: { item },
  global: {
    stubs: {
      UChatTool: ChatToolStub,
      UBadge: true
    }
  }
})

describe('SubagentActivity', () => {
  it.each([
    ['sendMessage', 'Message sent'],
    ['followupTask', 'Follow-up started'],
    ['interruptAgent', 'Agent interrupted'],
    ['listAgents', 'Agents listed']
  ] as const)('renders the %s collaboration action', (tool, expectedTitle) => {
    const wrapper = mountItem(makeItem(tool))

    expect(wrapper.getComponent(ChatToolStub).props('text')).toBe(expectedTitle)
  })

  it('renders interrupted tool calls as interrupted instead of completed', () => {
    const wrapper = mountItem(makeItem('sendMessage', 'interrupted'))
    const tool = wrapper.getComponent(ChatToolStub)

    expect(tool.props('text')).toBe('Message interrupted')
    expect(tool.props('icon')).toBe('i-lucide-circle-stop')
    expect(tool.props('open')).toBe(true)
  })

  it('renders agent-state targets that are absent from the receiver list', () => {
    const item = makeItem('listAgents')
    item.receiverThreadIds = []
    item.agentsStates = {
      'state-only-agent': {
        status: 'running',
        message: null
      }
    }
    const wrapper = mount(SubagentActivity, {
      props: {
        item,
        agentStates: [{
          threadId: 'state-only-agent',
          status: 'running',
          message: null
        }]
      },
      global: {
        stubs: {
          UChatTool: ChatToolStub,
          UBadge: true
        }
      }
    })

    expect(wrapper.getComponent(ChatToolStub).props('suffix')).toBe('state-on')
    expect(wrapper.text()).toContain('tostate-on')
  })
})

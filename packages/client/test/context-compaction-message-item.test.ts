// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'

import ContextCompaction from '../app/components/message-item/ContextCompaction.vue'
import MessagePartItem from '../app/components/message-part/Item'
import {
  ITEM_PART,
  type ChatPart
} from '../shared/codex-chat'

const SeparatorStub = defineComponent({
  name: 'USeparator',
  props: {
    label: {
      type: String,
      default: ''
    },
    color: {
      type: String,
      default: undefined
    },
    type: {
      type: String,
      default: undefined
    }
  },
  setup(props) {
    return () => h('div', {
      class: 'separator-stub',
      'data-label': props.label,
      'data-color': props.color,
      'data-type': props.type
    }, props.label)
  }
})

describe('ContextCompaction', () => {
  it('shows a compacting separator while the item is pending', () => {
    const wrapper = mount(ContextCompaction, {
      props: {
        pending: true
      },
      global: {
        stubs: {
          USeparator: SeparatorStub
        }
      }
    })

    expect(wrapper.text()).toBe('.. compacting thread ..')
    expect(wrapper.get('.separator-stub').attributes('data-type')).toBe('dashed')
  })

  it('shows a compacted separator after completion', () => {
    const wrapper = mount(ContextCompaction, {
      global: {
        stubs: {
          USeparator: SeparatorStub
        }
      }
    })

    expect(wrapper.text()).toBe('...compacted thread...')
    expect(wrapper.get('.separator-stub').attributes('data-color')).toBe('neutral')
  })

  it('uses the parent message pending state for context compaction items', () => {
    const part: Extract<ChatPart, { type: typeof ITEM_PART }> = {
      type: ITEM_PART,
      data: {
        kind: 'context_compaction',
        item: {
          type: 'contextCompaction',
          id: 'compact-1'
        }
      }
    }
    const wrapper = mount(MessagePartItem, {
      props: {
        part,
        messagePending: true
      },
      global: {
        stubs: {
          USeparator: SeparatorStub
        }
      }
    })

    expect(wrapper.text()).toBe('.. compacting thread ..')
  })
})

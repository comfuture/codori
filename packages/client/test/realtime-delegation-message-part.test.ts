// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import RealtimeDelegation from '../app/components/message-part/RealtimeDelegation.vue'
import { REALTIME_DELEGATION_PART } from '../shared/codex-chat'

const IconStub = defineComponent({
  name: 'UIcon',
  props: {
    name: {
      type: String,
      required: true
    }
  },
  setup(props) {
    return () => h('span', { 'data-icon': props.name })
  }
})

describe('RealtimeDelegation message part', () => {
  it('renders the delegated request compactly with optional conversation context', () => {
    const wrapper = mount(RealtimeDelegation, {
      props: {
        part: {
          type: REALTIME_DELEGATION_PART,
          data: {
            input: 'Check whether voice mode works',
            transcriptDelta: 'user: hello\nassistant: hello',
            source: 'handoff'
          }
        }
      },
      global: {
        stubs: {
          UIcon: IconStub
        }
      }
    })

    const delegation = wrapper.get('[data-realtime-delegation]')
    expect(delegation.classes()).toContain('text-xs')
    expect(delegation.classes()).toContain('text-muted')
    expect(wrapper.get('[data-icon]').attributes('data-icon')).toBe('i-lucide-audio-lines')
    expect(wrapper.text()).toContain('Voice delegation')
    expect(wrapper.text()).toContain('Check whether voice mode works')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.get('pre').text()).toBe('user: hello\nassistant: hello')
  })

  it('omits transcript disclosure when no context was attached', () => {
    const wrapper = mount(RealtimeDelegation, {
      props: {
        part: {
          type: REALTIME_DELEGATION_PART,
          data: {
            input: 'Run the focused tests',
            transcriptDelta: null,
            source: 'handoff'
          }
        }
      },
      global: {
        stubs: {
          UIcon: IconStub
        }
      }
    })

    expect(wrapper.text()).toContain('Run the focused tests')
    expect(wrapper.find('details').exists()).toBe(false)
  })
})

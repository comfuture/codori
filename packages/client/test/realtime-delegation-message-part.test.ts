// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */

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

const BadgeStub = defineComponent({
  name: 'UBadge',
  props: {
    label: {
      type: String,
      default: ''
    }
  },
  setup(props) {
    return () => h('span', { 'data-badge': props.label }, props.label)
  }
})

const TooltipStub = defineComponent({
  name: 'UTooltip',
  props: {
    text: {
      type: String,
      default: ''
    }
  },
  setup(props, { slots }) {
    return () => h('span', { 'data-tooltip': props.text }, slots.default?.())
  }
})

const stubs = {
  UIcon: IconStub,
  UBadge: BadgeStub,
  UTooltip: TooltipStub
}

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
        stubs
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
        stubs
      }
    })

    expect(wrapper.text()).toContain('Run the focused tests')
    expect(wrapper.find('details').exists()).toBe(false)
  })

  it('marks the realtime-voice channel with a compact labelled badge', () => {
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
        stubs
      }
    })

    expect(wrapper.get('[data-badge]').text()).toBe('Voice')
    expect(wrapper.get('[data-tooltip]').attributes('data-tooltip'))
      .toBe('This request arrived through a realtime voice conversation.')
    // The icon and label carry the signal for screen readers, not the badge alone.
    expect(wrapper.get('[data-icon]').attributes('data-icon')).toBe('i-lucide-audio-lines')
    expect(wrapper.text()).toContain('Voice delegation')
  })

  it('renders a partial delegation as the designed block rather than raw markup', () => {
    const wrapper = mount(RealtimeDelegation, {
      props: {
        part: {
          type: REALTIME_DELEGATION_PART,
          data: {
            input: '',
            transcriptDelta: '<unknown_field>x</unknown_field>',
            source: 'handoff',
            parse: 'partial'
          }
        }
      },
      global: {
        stubs
      }
    })

    const delegation = wrapper.get('[data-realtime-delegation]')
    expect(delegation.attributes('data-realtime-delegation-parse')).toBe('partial')
    expect(wrapper.text()).toContain('No request text was recognized in this delegation.')
    expect(wrapper.get('details').attributes('open')).toBeUndefined()
    expect(wrapper.get('pre').text()).toBe('<unknown_field>x</unknown_field>')
  })
})

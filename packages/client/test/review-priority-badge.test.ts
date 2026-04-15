// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'

import ReviewPriorityBadge from '../app/components/message-part/ReviewPriorityBadge.vue'

const BadgeStub = defineComponent({
  name: 'UBadge',
  props: {
    as: {
      type: String,
      default: 'span'
    },
    color: {
      type: String,
      default: undefined
    },
    variant: {
      type: String,
      default: undefined
    },
    size: {
      type: String,
      default: undefined
    },
    ui: {
      type: Object,
      default: () => ({})
    }
  },
  setup(props, { slots }) {
    return () => h(props.as, {
      class: 'badge-stub',
      'data-color': props.color,
      'data-variant': props.variant,
      'data-size': props.size,
      'data-base': props.ui?.base ?? ''
    }, slots.default?.())
  }
})

describe('ReviewPriorityBadge', () => {
  it('renders a styled warning badge for a high-priority finding', () => {
    const wrapper = mount(ReviewPriorityBadge, {
      props: {
        priority: '1'
      },
      global: {
        stubs: {
          UBadge: BadgeStub
        }
      }
    })

    expect(wrapper.text()).toBe('P1')
    expect(wrapper.get('.badge-stub').attributes('data-color')).toBe('warning')
    expect(wrapper.get('.badge-stub').attributes('data-variant')).toBe('soft')
    expect(wrapper.get('.badge-stub').attributes('data-base')).toContain('text-[#fdba74]')
  })

  it('changes the tone for lower-priority findings', () => {
    const wrapper = mount(ReviewPriorityBadge, {
      props: {
        priority: '3'
      },
      global: {
        stubs: {
          UBadge: BadgeStub
        }
      }
    })

    expect(wrapper.text()).toBe('P3')
    expect(wrapper.get('.badge-stub').attributes('data-base')).toContain('text-[#fde68a]')
  })
})

/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import PlanTaskListPanel from '../app/components/PlanTaskListPanel.vue'

const IconStub = defineComponent({
  name: 'IconStub',
  props: {
    name: {
      type: String,
      default: ''
    },
    class: {
      type: String,
      default: ''
    }
  },
  setup(props) {
    return () => h('span', {
      class: props.class,
      'data-icon': props.name
    })
  }
})

const BadgeStub = defineComponent({
  name: 'BadgeStub',
  setup(_, { slots }) {
    return () => h('span', { class: 'badge-stub' }, slots.default?.())
  }
})

const mountPanel = (panelOpen: boolean) =>
  mount(PlanTaskListPanel, {
    props: {
      plan: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        explanation: 'Keep the task list pinned while the transcript scrolls.',
        plan: [{
          step: 'Inspect upstream signals',
          status: 'completed'
        }, {
          step: 'Render sticky task list',
          status: 'inProgress'
        }, {
          step: 'Capture screenshot',
          status: 'pending'
        }],
        structuralSignature: '["Inspect upstream signals","Render sticky task list","Capture screenshot"]',
        panelOpen,
        updatedAt: 1
      }
    },
    global: {
      stubs: {
        UIcon: IconStub,
        UBadge: BadgeStub
      }
    }
  })

describe('plan task list panel', () => {
  it('renders explanation, status labels, and visible tasks when expanded', () => {
    const wrapper = mountPanel(true)

    expect(wrapper.text()).toContain('Task list')
    expect(wrapper.text()).toContain('Keep the task list pinned while the transcript scrolls.')
    expect(wrapper.text()).toContain('1. Inspect upstream signals')
    expect(wrapper.text()).toContain('1 active')
    expect(wrapper.text()).toContain('1 done')
    expect(wrapper.text()).toContain('1 pending')
    expect(wrapper.findAll('li')).toHaveLength(3)
    expect(wrapper.find('[data-icon="i-lucide-check"]').exists()).toBe(true)
    expect(wrapper.find('[data-icon="i-lucide-loader-circle"]').exists()).toBe(true)
  })

  it('emits toggle requests and hides the list body when collapsed', async () => {
    const wrapper = mountPanel(false)

    expect(wrapper.findAll('li')).toHaveLength(0)

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('toggle')?.[0]).toEqual([true])
  })
})

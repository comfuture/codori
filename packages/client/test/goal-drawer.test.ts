/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import GoalDrawer from '../app/components/GoalDrawer.vue'
import type { ThreadGoal } from '../shared/generated/codex-app-server/v2/ThreadGoal'

const testGoal = (overrides: Partial<ThreadGoal> = {}): ThreadGoal => ({
  threadId: 'thread-1',
  objective: 'Ship persistent goal support',
  status: 'active',
  tokenBudget: 1000,
  tokensUsed: 125,
  timeUsedSeconds: 90 * 60,
  createdAt: 1,
  updatedAt: 2,
  ...overrides
})

const DrawerStub = defineComponent({
  name: 'DrawerStub',
  props: {
    open: {
      type: Boolean,
      default: false
    },
    title: {
      type: String,
      default: ''
    },
    description: {
      type: String,
      default: ''
    }
  },
  emits: ['update:open'],
  setup(props, { slots }) {
    return () => props.open
      ? h('section', { class: 'drawer-stub' }, [
          h('h2', props.title),
          h('p', props.description),
          slots.default?.()
        ])
      : null
  }
})

const ButtonStub = defineComponent({
  name: 'ButtonStub',
  props: {
    type: {
      type: String,
      default: 'button'
    }
  },
  emits: ['click'],
  setup(props, { slots, emit }) {
    return () => h('button', {
      type: props.type,
      onClick: () => emit('click')
    }, slots.default?.())
  }
})

const TextareaStub = defineComponent({
  name: 'TextareaStub',
  props: {
    modelValue: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('textarea', {
      value: props.modelValue,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
    })
  }
})

const mountDrawer = (props: Record<string, unknown>) =>
  mount(GoalDrawer, {
    props: {
      open: true,
      ...props
    },
    global: {
      stubs: {
        BottomDrawerShell: DrawerStub,
        UAlert: true,
        UBadge: true,
        UButton: ButtonStub,
        UIcon: true,
        UTextarea: TextareaStub
      }
    }
  })

describe('goal drawer', () => {
  it('renders active goal details and control actions', async () => {
    const wrapper = mountDrawer({
      goal: testGoal()
    })

    expect(wrapper.text()).toContain('Thread goal')
    expect(wrapper.text()).toContain('Ship persistent goal support')
    expect(wrapper.text()).toContain('1h 30m')
    expect(wrapper.text()).toContain('125 / 1,000 tokens')

    await wrapper.findAll('button').find(button => button.text() === 'Pause')?.trigger('click')
    expect(wrapper.emitted('pause')).toHaveLength(1)
  })

  it('emits edited goal objectives', async () => {
    const wrapper = mountDrawer({
      mode: 'edit',
      draftObjective: 'Old objective'
    })

    await wrapper.get('textarea').setValue('New objective')
    expect(wrapper.emitted('update:draftObjective')?.[0]).toEqual(['New objective'])
    await wrapper.setProps({ draftObjective: 'New objective' })

    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('saveObjective')?.[0]).toEqual(['New objective'])
  })

  it('renders an empty state when no goal exists', () => {
    const wrapper = mountDrawer({
      goal: null
    })

    expect(wrapper.text()).toContain('No goal is currently set for this thread.')
    expect(wrapper.text()).toContain('/goal <objective>')
  })
})

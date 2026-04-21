/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { describe, expect, it } from 'vitest'
import PlanImplementationPromptDrawer from '../app/components/PlanImplementationPromptDrawer.vue'

const BottomDrawerShellStub = defineComponent({
  name: 'BottomDrawerShellStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  setup(props, { slots }) {
    return () => props.open
      ? h('div', { class: 'drawer-shell-stub' }, slots.default?.())
      : null
  }
})

const ButtonStub = defineComponent({
  name: 'ButtonStub',
  props: {
    type: {
      type: String,
      default: 'button'
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['click'],
  setup(props, { emit, slots }) {
    return () => h('button', {
      type: props.type,
      disabled: props.disabled,
      onClick: (event: MouseEvent) => emit('click', event)
    }, slots.default?.())
  }
})

const InputStub = defineComponent({
  name: 'InputStub',
  props: {
    modelValue: {
      type: String,
      default: ''
    },
    size: {
      type: String,
      default: undefined
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('input', {
      class: 'revision-input',
      value: props.modelValue,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value)
    })
  }
})

const mountDrawer = (props: { open: boolean }) =>
  mount(PlanImplementationPromptDrawer, {
    attachTo: document.body,
    props,
    global: {
      stubs: {
        BottomDrawerShell: BottomDrawerShellStub,
        UButton: ButtonStub,
        UInput: InputStub
      }
    }
  })

describe('plan implementation prompt drawer', () => {
  it('focuses the implement button when the drawer opens', async () => {
    const wrapper = mountDrawer({ open: true })

    await nextTick()

    expect(document.activeElement).toBe(wrapper.findAll('button')[0]?.element)
  })

  it('emits implement when the primary action is clicked', async () => {
    const wrapper = mountDrawer({ open: true })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('implement')).toHaveLength(1)
  })

  it('emits a trimmed plan revision prompt on submit', async () => {
    const wrapper = mountDrawer({ open: true })

    await wrapper.get('.revision-input').setValue('  Add a rollback step  ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('revisePlan')?.[0]).toEqual(['Add a rollback step'])
  })

  it('does not emit a plan revision prompt for empty input', async () => {
    const wrapper = mountDrawer({ open: true })

    await wrapper.get('.revision-input').setValue('   ')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('revisePlan')).toBeUndefined()
  })
})

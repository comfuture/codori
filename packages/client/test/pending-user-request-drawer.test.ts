/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import PendingUserRequestDrawer from '../app/components/PendingUserRequestDrawer.vue'
import type { PendingUserRequest } from '../shared/pending-user-request'

const DrawerStub = defineComponent({
  name: 'DrawerStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:open'],
  setup(props, { slots }) {
    return () => h('div', {
      class: 'drawer-stub',
      'data-open': String(props.open)
    }, [
      h('div', { class: 'drawer-header' }, slots.header?.()),
      h('div', { class: 'drawer-body' }, slots.body?.())
    ])
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
      type: [String, Number],
      default: ''
    },
    type: {
      type: String,
      default: 'text'
    },
    id: {
      type: String,
      default: undefined
    },
    placeholder: {
      type: String,
      default: undefined
    },
    size: {
      type: String,
      default: undefined
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('input', {
      id: props.id,
      type: props.type,
      placeholder: props.placeholder,
      value: props.modelValue,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value)
    })
  }
})

const FormFieldStub = defineComponent({
  name: 'FormFieldStub',
  props: {
    label: {
      type: String,
      default: undefined
    },
    description: {
      type: String,
      default: undefined
    },
    help: {
      type: String,
      default: undefined
    },
    error: {
      type: [String, Boolean],
      default: undefined
    }
  },
  setup(props, { slots }) {
    return () => h('div', { class: 'form-field-stub' }, [
      props.label ? h('label', props.label) : null,
      props.description ? h('p', props.description) : null,
      slots.default?.(),
      typeof props.error === 'string' ? h('p', props.error) : null,
      props.help ? h('p', props.help) : null
    ])
  }
})

const NavigationMenuStub = defineComponent({
  name: 'NavigationMenuStub',
  props: {
    items: {
      type: Array,
      default: () => []
    }
  },
  setup(props, { slots }) {
    return () => h('div', { class: 'navigation-menu-stub' }, (props.items as Array<Record<string, unknown>>).map((item, index) =>
      h('button', {
        key: `${String(item.label)}-${index}`,
        type: 'button',
        'data-active': String(item.active === true),
        onClick: (event: Event) => {
          const onSelect = item.onSelect
          if (typeof onSelect === 'function') {
            onSelect(event)
          }
        }
      }, [
        slots['item-label']?.({ item }),
        slots['item-trailing']?.({ item })
      ])
    ))
  }
})

const mountDrawer = (request: PendingUserRequest | null) =>
  mount(PendingUserRequestDrawer, {
    props: { request },
    global: {
      stubs: {
        UDrawer: DrawerStub,
        UButton: ButtonStub,
        UInput: InputStub,
        UFormField: FormFieldStub,
        UNavigationMenu: NavigationMenuStub,
        UIcon: defineComponent({
          name: 'IconStub',
          setup() {
            return () => h('span', { class: 'icon-stub' })
          }
        })
      }
    }
  })

describe('pending user request drawer', () => {
  it('renders request-user-input as a sequential flow and emits structured answers on the last answer', async () => {
    const wrapper = mountDrawer({
      kind: 'requestUserInput',
      requestId: 1,
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      questions: [{
        header: 'Implementation',
        id: 'plan',
        question: 'Which direction should Codex take?',
        options: [{
          label: 'Use drawer',
          description: 'Move it out of the chat composer'
        }],
        isOther: true,
        isSecret: false
      }]
    })

    expect(wrapper.find('.drawer-stub').attributes('data-open')).toBe('true')
    expect(wrapper.text()).toContain('Which direction should Codex take?')
    expect(wrapper.text()).not.toContain('Implementation')
    expect(wrapper.text()).not.toContain('Pending request')
    expect(wrapper.text()).not.toContain('Custom answer')

    await wrapper.get('button[type="button"]').trigger('click')

    expect(wrapper.emitted('respond')?.[0]?.[0]).toEqual({
      answers: {
        plan: ['Use drawer']
      }
    })
  })

  it('advances across multiple questions and submits from the final custom answer step', async () => {
    const wrapper = mountDrawer({
      kind: 'requestUserInput',
      requestId: 11,
      threadId: 'thread-1',
      turnId: 'turn-1',
      itemId: 'item-1',
      questions: [{
        header: 'Layout',
        id: 'layout',
        question: 'Choose the drawer layout.',
        options: [{
          label: 'Compact',
          description: 'Keep the layout dense.'
        }],
        isOther: false,
        isSecret: false
      }, {
        header: 'Notes',
        id: 'notes',
        question: 'Add any final guidance.',
        options: [],
        isOther: false,
        isSecret: false
      }]
    })

    expect(wrapper.text()).toContain('Choose the drawer layout.')
    expect(wrapper.text()).not.toContain('Add any final guidance.')

    await wrapper.get('button[type="button"]').trigger('click')

    expect(wrapper.text()).toContain('Add any final guidance.')
    expect(wrapper.text()).not.toContain('Choose the drawer layout.')

    await wrapper.get('input[type="text"]').setValue('Keep the controls left aligned.')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.emitted('respond')?.[0]?.[0]).toEqual({
      answers: {
        layout: ['Compact'],
        notes: ['Keep the controls left aligned.']
      }
    })
  })

  it('renders secret input fields as password controls', async () => {
    const wrapper = mountDrawer({
      kind: 'requestUserInput',
      requestId: 2,
      threadId: null,
      turnId: null,
      itemId: null,
      questions: [{
        header: null,
        id: 'token',
        question: 'Enter the token',
        options: [],
        isOther: false,
        isSecret: true
      }]
    })

    expect(wrapper.text()).not.toContain('Answer')
    expect(wrapper.find('input[type="password"]').exists()).toBe(true)
  })

  it('renders elicitation form requests and emits typed accept payloads', async () => {
    const wrapper = mountDrawer({
      kind: 'mcpElicitationForm',
      requestId: 3,
      message: 'Provide the release metadata.',
      fields: [{
        kind: 'string',
        key: 'email',
        label: 'Email',
        description: null,
        required: true,
        minLength: null,
        maxLength: 80,
        format: 'email',
        defaultValue: null
      }, {
        kind: 'number',
        key: 'attempts',
        label: 'Attempts',
        description: null,
        required: true,
        numericType: 'integer',
        minimum: 1,
        maximum: 5,
        defaultValue: null
      }]
    })

    const inputs = wrapper.findAll('input')
    await inputs[0]!.setValue('octocat@example.com')
    await inputs[1]!.setValue('3')
    await wrapper.get('button[type="submit"]').trigger('submit')

    expect(wrapper.emitted('respond')?.[0]?.[0]).toEqual({
      action: 'accept',
      content: {
        email: 'octocat@example.com',
        attempts: 3
      }
    })
  })

  it('supports url-mode accept, decline, and cancel actions', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    const wrapper = mountDrawer({
      kind: 'mcpElicitationUrl',
      requestId: 4,
      message: 'Authorize the connector.',
      url: 'https://example.com/oauth',
      elicitationId: 'elic-2'
    })

    const buttons = wrapper.findAll('button')
    await buttons[0]!.trigger('click')
    await buttons[1]!.trigger('click')
    await buttons[2]!.trigger('click')
    await nextTick()

    expect(wrapper.emitted('respond')?.map(event => event[0])).toEqual([{
      action: 'decline'
    }, {
      action: 'cancel'
    }, {
      action: 'accept'
    }])
    expect(openSpy).toHaveBeenCalledWith('https://example.com/oauth', '_blank', 'noopener,noreferrer')
  })
})

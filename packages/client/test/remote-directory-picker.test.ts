// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.hoisted(() => vi.fn())

vi.mock('#imports', () => ({
  useRuntimeConfig: () => ({ public: { serverBase: '' } })
}))

vi.mock('ofetch', () => ({
  $fetch: mockFetch
}))

import RemoteDirectoryPicker from '../app/components/RemoteDirectoryPicker.vue'

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: { type: { type: String, default: 'button' }, disabled: Boolean },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    return () => h('button', {
      ...attrs,
      type: props.type,
      disabled: props.disabled,
      onClick: (event: MouseEvent) => emit('click', event)
    }, slots.default?.())
  }
})

const InputStub = defineComponent({
  props: { modelValue: { type: String, default: '' }, disabled: Boolean },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('input', {
      value: props.modelValue,
      disabled: props.disabled,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value)
    })
  }
})

const ModalStub = defineComponent({
  props: { open: Boolean },
  setup(props, { slots }) {
    return () => props.open ? h('div', { class: 'modal-stub' }, slots.body?.()) : null
  }
})

const BreadcrumbStub = defineComponent({
  props: { items: { type: Array, default: () => [] } },
  setup(props, { slots }) {
    return () => h('nav', { class: 'breadcrumb-stub' },
      (props.items as Array<Record<string, unknown>>).map(item => slots.item?.({ item }))
    )
  }
})

const mountPicker = (modelValue: string[] = []) => mount(RemoteDirectoryPicker, {
  props: { modelValue },
  global: {
    stubs: {
      UButton: ButtonStub,
      UInput: InputStub,
      UModal: ModalStub,
      UForm: defineComponent({ template: '<form><slot /></form>' }),
      UFormField: defineComponent({ template: '<div><slot /></div>' }),
      UBreadcrumb: BreadcrumbStub,
      UAlert: defineComponent({
        props: { title: { type: String, default: '' } },
        template: '<div role="alert">{{ title }}</div>'
      })
    }
  }
})

describe('remote directory picker', () => {
  beforeEach(() => {
    mockFetch.mockReset()
  })

  it('browses and returns absolute paths from the Codori server without a browser directory handle', async () => {
    mockFetch.mockResolvedValue({
      directory: {
        path: '/srv/codori',
        entries: [
          { name: 'packages', isDirectory: true },
          { name: 'README.md', isDirectory: false }
        ]
      }
    })
    const wrapper = mountPicker()

    await wrapper.get('button').trigger('click')
    await wrapper.get('input').setValue('/srv/codori')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mockFetch).toHaveBeenCalledWith(expect.stringMatching(/\/api\/projects\/directories$/u), {
      query: { path: '/srv/codori' }
    })
    expect(wrapper.text()).toContain('packages')
    expect(wrapper.text()).not.toContain('README.md')

    const addFolder = wrapper.findAll('button').find(button => button.text() === 'Add this folder')
    expect(addFolder).toBeDefined()
    await addFolder!.trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[['/srv/codori']]])
    expect('showDirectoryPicker' in window).toBe(false)
  })

  it('keeps the modal open and reports server-side directory errors', async () => {
    mockFetch.mockRejectedValue(new Error('Permission denied: /root'))
    const wrapper = mountPicker()

    await wrapper.get('button').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.modal-stub').exists()).toBe(true)
    expect(wrapper.get('[role="alert"]').text()).toContain('Permission denied: /root')
  })
})

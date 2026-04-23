/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import WorkspaceBranchControl from '../app/components/WorkspaceBranchControl.vue'

const PopoverStub = defineComponent({
  name: 'PopoverStub',
  setup(_props, { slots }) {
    return () => h('div', { class: 'popover-stub' }, [
      slots.default?.(),
      h('div', { class: 'popover-content' }, slots.content?.())
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
  setup(props, { emit, slots, attrs }) {
    return () => h('button', {
      ...attrs,
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
    placeholder: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue', 'keydown'],
  setup(props, { emit, attrs }) {
    return () => h('input', {
      ...attrs,
      value: props.modelValue,
      placeholder: props.placeholder,
      disabled: props.disabled,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value),
      onKeydown: (event: KeyboardEvent) => emit('keydown', event)
    })
  }
})

const mountControl = (props: Record<string, unknown>) =>
  mount(WorkspaceBranchControl, {
    props,
    global: {
      stubs: {
        UPopover: PopoverStub,
        UButton: ButtonStub,
        UInput: InputStub,
        UAlert: defineComponent({
          name: 'AlertStub',
          props: {
            title: {
              type: String,
              default: ''
            }
          },
          setup(props) {
            return () => h('div', { class: 'alert-stub' }, props.title)
          }
        }),
        UIcon: defineComponent({
          name: 'IconStub',
          setup() {
            return () => h('span', { class: 'icon-stub' })
          }
        })
      }
    }
  })

describe('workspace branch control', () => {
  it('renders the current branch, filters local branches, and emits switch/create actions', async () => {
    const wrapper = mountControl({
      currentBranch: 'main',
      branches: ['feature/demo', 'main', 'release']
    })

    expect(wrapper.text()).toContain('main')
    expect(wrapper.text()).toContain('feature/demo')
    expect(wrapper.text()).toContain('release')

    const searchInput = wrapper.find('input[placeholder="Search local branches"]')
    await searchInput.setValue('rel')

    expect(wrapper.text()).not.toContain('feature/demo')
    expect(wrapper.text()).toContain('release')

    await wrapper.get('[data-branch-option="release"]').trigger('click')
    expect(wrapper.emitted('switchBranch')?.[0]?.[0]).toBe('release')

    const createInput = wrapper.find('input[placeholder="feature/new-branch"]')
    await createInput.setValue('feature/new-work')
    await wrapper.get('[data-create-branch]').trigger('click')

    expect(wrapper.emitted('createBranch')?.[0]?.[0]).toBe('feature/new-work')
  })

  it('does not render when the workspace is not a git repository', () => {
    const wrapper = mountControl({
      currentBranch: null,
      branches: []
    })

    expect(wrapper.find('[data-workspace-branch-trigger]').exists()).toBe(false)
  })
})

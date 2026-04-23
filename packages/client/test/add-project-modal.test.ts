/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddProjectModal from '../app/components/AddProjectModal.vue'

const mockRouterPush = vi.fn()
const mockCloneProject = vi.fn()
const mockRefreshProjects = vi.fn()
const mockClonePending = ref(false)

vi.mock('../app/composables/useCodoriRouter', () => ({
  useCodoriRouter: () => ({
    push: mockRouterPush
  })
}))

vi.mock('../app/composables/useProjects', () => ({
  useProjects: () => ({
    clonePending: mockClonePending,
    cloneProject: mockCloneProject,
    refreshProjects: mockRefreshProjects
  })
}))

const ModalStub = defineComponent({
  name: 'ModalStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  setup(props, { slots }) {
    return () => props.open
      ? h('div', { class: 'modal-stub' }, [
          h('div', { class: 'modal-body' }, slots.body?.())
        ])
      : null
  }
})

const FormFieldStub = defineComponent({
  name: 'FormFieldStub',
  props: {
    label: {
      type: String,
      default: ''
    },
    description: {
      type: String,
      default: ''
    }
  },
  setup(props, { slots }) {
    return () => h('label', { class: 'form-field-stub' }, [
      h('span', { class: 'field-label' }, props.label),
      props.description ? h('span', { class: 'field-description' }, props.description) : null,
      slots.default?.()
    ])
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
    size: {
      type: String,
      default: ''
    },
    disabled: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('input', {
      class: 'input-stub',
      value: props.modelValue,
      placeholder: props.placeholder,
      disabled: props.disabled,
      onInput: (event: Event) => emit('update:modelValue', (event.target as HTMLInputElement).value)
    })
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

const AlertStub = defineComponent({
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
})

const mountModal = (props: Record<string, unknown> = {}) =>
  mount(AddProjectModal, {
    props: {
      open: true,
      ...props
    },
    global: {
      stubs: {
        UModal: ModalStub,
        UFormField: FormFieldStub,
        UInput: InputStub,
        UButton: ButtonStub,
        UAlert: AlertStub
      }
    }
  })

describe('add project modal', () => {
  beforeEach(() => {
    mockRouterPush.mockReset()
    mockCloneProject.mockReset()
    mockRefreshProjects.mockReset()
    mockClonePending.value = false
  })

  it('submits the clone request, refreshes projects, and navigates to the new project', async () => {
    mockCloneProject.mockResolvedValue({
      projectId: 'team/codori'
    })
    mockRefreshProjects.mockResolvedValue(undefined)
    mockRouterPush.mockResolvedValue(undefined)

    const wrapper = mountModal()
    const inputs = wrapper.findAll('input')

    await inputs[0]!.setValue('  https://github.com/comfuture/codori  ')
    await inputs[1]!.setValue(' team/codori ')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mockCloneProject).toHaveBeenCalledWith({
      repositoryUrl: 'https://github.com/comfuture/codori',
      destination: 'team/codori'
    })
    expect(mockRefreshProjects).toHaveBeenCalledTimes(1)
    expect(mockRouterPush).toHaveBeenCalledWith('/projects/team/codori')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('renders inline clone errors from the server response', async () => {
    mockCloneProject.mockRejectedValue({
      data: {
        error: {
          message: 'Destination "team/codori" already exists under the configured Codori root.'
        }
      }
    })

    const wrapper = mountModal()
    const inputs = wrapper.findAll('input')

    await inputs[0]!.setValue('https://github.com/comfuture/codori')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Destination "team/codori" already exists under the configured Codori root.')
    expect(mockRefreshProjects).not.toHaveBeenCalled()
    expect(mockRouterPush).not.toHaveBeenCalled()
  })
})

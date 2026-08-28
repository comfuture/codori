/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AddProjectModal from '../app/components/AddProjectModal.vue'

const mockRouterPush = vi.fn()
const mockCreateProject = vi.fn()
const mockClonePending = ref(false)

vi.mock('../app/composables/useCodoriRouter', () => ({
  useCodoriRouter: () => ({
    push: mockRouterPush
  })
}))

vi.mock('../app/composables/useProjects', () => ({
  useProjects: () => ({
    clonePending: mockClonePending,
    createProject: mockCreateProject
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
        UAlert: AlertStub,
        RemoteDirectoryPicker: defineComponent({
          props: { modelValue: { type: Array, default: () => [] } },
          emits: ['update:modelValue'],
          setup(_, { emit }) { return () => h('button', { class: 'picker-stub', onClick: () => emit('update:modelValue', ['/srv/codori']) }) }
        })
      }
    }
  })

describe('add project modal', () => {
  beforeEach(() => {
    mockRouterPush.mockReset()
    mockCreateProject.mockReset()
    mockClonePending.value = false
  })

  it('creates an app-server project and navigates to it', async () => {
    mockCreateProject.mockResolvedValue({
      projectId: 'project-1'
    })
    mockRouterPush.mockResolvedValue(undefined)

    const wrapper = mountModal()
    const inputs = wrapper.findAll('input')

    await inputs[0]!.setValue('  Codori  ')
    await wrapper.get('.picker-stub').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(mockCreateProject).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Codori',
      roots: ['/srv/codori']
    }))
    expect(mockRouterPush).toHaveBeenCalledWith('/projects/project-1')
    expect(wrapper.emitted('update:open')).toEqual([[false]])
  })

  it('renders inline app-server errors', async () => {
    mockCreateProject.mockRejectedValue({
      data: {
        error: {
          message: 'The server directory is unavailable.'
        }
      }
    })

    const wrapper = mountModal()
    const inputs = wrapper.findAll('input')

    await inputs[0]!.setValue('Codori')
    await wrapper.get('.picker-stub').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('The server directory is unavailable.')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(mockCreateProject).toHaveBeenCalledTimes(2)
    expect(mockCreateProject.mock.calls[1]![0]!.idempotencyKey)
      .toBe(mockCreateProject.mock.calls[0]![0]!.idempotencyKey)
    expect(mockRouterPush).not.toHaveBeenCalled()
  })

  it('requires a server folder selection', async () => {
    const wrapper = mountModal()
    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('Project name is required.')
  })
})

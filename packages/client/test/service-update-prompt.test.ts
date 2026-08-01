// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const routeMock = vi.hoisted(() => ({
  path: '/',
  fullPath: '/'
}))

vi.mock('#imports', () => ({
  useRoute: () => routeMock
}))

vi.mock('../app/composables/useProjects', async () => {
  const { ref: createRef } = await import('vue')

  const state = {
    serviceUpdate: createRef({
      enabled: true,
      updateAvailable: true,
      updating: false,
      installedVersion: '0.10.0',
      latestVersion: '0.11.0'
    }),
    serviceUpdatePending: createRef(false),
    refreshServiceUpdate: vi.fn(async () => undefined),
    triggerServiceUpdate: vi.fn(async () => undefined)
  }

  return {
    useProjects: () => state,
    __state: state
  }
})

import DefaultLayout from '../app/layouts/default.vue'
import * as useProjectsModule from '../app/composables/useProjects'

const projectsMock = (useProjectsModule as unknown as {
  __state: {
    serviceUpdate: { value: Record<string, unknown> }
    serviceUpdatePending: { value: boolean }
    refreshServiceUpdate: ReturnType<typeof vi.fn>
    triggerServiceUpdate: ReturnType<typeof vi.fn>
  }
}).__state

const ButtonStub = defineComponent({
  props: {
    label: {
      type: String,
      default: ''
    }
  },
  emits: ['click'],
  template: '<button @click="$emit(\'click\')">{{ label }}<slot /></button>'
})

const ModalStub = defineComponent({
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  template: '<div data-testid="modal" :data-open="String(open)"><slot name="body" /><slot name="footer" /></div>'
})

const PassthroughStub = defineComponent({
  template: '<div><slot /></div>'
})

// The update trigger lives in the sidebar's `#header` slot, so the stub has to
// render named slots rather than only the default one.
const SidebarStub = defineComponent({
  template: `
    <div>
      <slot name="header" :collapsed="false" />
      <slot />
      <slot name="footer" :collapsed="false" />
    </div>
  `
})

const mountLayout = () => mount(DefaultLayout, {
  global: {
    stubs: {
      UButton: ButtonStub,
      UModal: ModalStub,
      UTooltip: PassthroughStub,
      UDashboardGroup: PassthroughStub,
      UDashboardSidebar: SidebarStub,
      UDashboardSidebarCollapse: PassthroughStub,
      GlobalCommandPalette: PassthroughStub,
      ProjectSidebar: PassthroughStub
    }
  }
})

const findButtonByText = (
  wrapper: ReturnType<typeof mountLayout>,
  text: string
) => wrapper.findAll('button').find(button => button.text().trim() === text)

// The sidebar trigger renders its label through slot content rather than the
// `label` prop, so match it separately from the dialog's confirm button.
const findUpdateTrigger = (wrapper: ReturnType<typeof mountLayout>) =>
  wrapper.findAll('button').find((button) => {
    const text = button.text().trim()
    return text.startsWith('Update') && text !== 'Update and restart'
  })

describe('service update prompt', () => {
  beforeEach(() => {
    projectsMock.triggerServiceUpdate.mockClear()
    projectsMock.refreshServiceUpdate.mockClear()
    projectsMock.serviceUpdatePending.value = false
    projectsMock.serviceUpdate.value = {
      enabled: true,
      updateAvailable: true,
      updating: false,
      installedVersion: '0.10.0',
      latestVersion: '0.11.0'
    }
  })

  it('checks for updates on mount without restarting the service', () => {
    mountLayout()

    expect(projectsMock.refreshServiceUpdate).toHaveBeenCalled()
    expect(projectsMock.triggerServiceUpdate).not.toHaveBeenCalled()
  })

  it('requires an explicit confirmation before restarting', async () => {
    const wrapper = mountLayout()

    const updateButton = findUpdateTrigger(wrapper)
    expect(updateButton).toBeDefined()

    await updateButton?.trigger('click')
    // Opening the dialog must not restart anything on its own.
    expect(projectsMock.triggerServiceUpdate).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="modal"]').attributes('data-open')).toBe('true')

    const confirmButton = findButtonByText(wrapper, 'Update and restart')
    await confirmButton?.trigger('click')

    expect(projectsMock.triggerServiceUpdate).toHaveBeenCalledTimes(1)
  })

  it('dismisses without updating when the user declines', async () => {
    const wrapper = mountLayout()

    const updateButton = findUpdateTrigger(wrapper)
    await updateButton?.trigger('click')

    const dismissButton = findButtonByText(wrapper, 'Not now')
    await dismissButton?.trigger('click')

    expect(projectsMock.triggerServiceUpdate).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="modal"]').attributes('data-open')).toBe('false')
  })
})

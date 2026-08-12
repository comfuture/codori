// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const reloadPageMock = vi.hoisted(() => vi.fn())

const routeMock = vi.hoisted(() => ({
  path: '/',
  fullPath: '/'
}))

vi.mock('#imports', () => ({
  useRoute: () => routeMock
}))

vi.mock('../app/utils/service-update-completion', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../app/utils/service-update-completion')>()
  return {
    ...actual,
    reloadPage: reloadPageMock
  }
})

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

// The update trigger lives in the sidebar's `#footer` slot, so the stub has to
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

const findUpdateTrigger = (wrapper: ReturnType<typeof mountLayout>) =>
  wrapper.find('[data-testid="service-update-button"]')

describe('service update prompt', () => {
  beforeEach(() => {
    reloadPageMock.mockClear()
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('checks for updates on mount without restarting the service', () => {
    mountLayout()

    expect(projectsMock.refreshServiceUpdate).toHaveBeenCalled()
    expect(projectsMock.triggerServiceUpdate).not.toHaveBeenCalled()
  })

  it('requires an explicit confirmation before restarting', async () => {
    const wrapper = mountLayout()

    const updateButton = findUpdateTrigger(wrapper)
    expect(updateButton.exists()).toBe(true)

    await updateButton.trigger('click')
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
    await updateButton.trigger('click')

    const dismissButton = findButtonByText(wrapper, 'Not now')
    await dismissButton?.trigger('click')

    expect(projectsMock.triggerServiceUpdate).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="modal"]').attributes('data-open')).toBe('false')
  })

  it('replaces the download icon with a spinner while updating', async () => {
    const wrapper = mountLayout()
    const updateButton = findUpdateTrigger(wrapper)

    expect(updateButton.find('[name="i-lucide-download"]').exists()).toBe(true)
    expect(updateButton.find('[name="i-lucide-loader-circle"]').exists()).toBe(false)

    projectsMock.serviceUpdate.value = {
      enabled: true,
      updateAvailable: true,
      updating: true,
      installedVersion: '0.10.0',
      latestVersion: '0.11.0'
    }
    await nextTick()

    expect(updateButton.find('[name="i-lucide-download"]').exists()).toBe(false)
    const spinner = updateButton.get('[name="i-lucide-loader-circle"]')
    expect(spinner.classes()).toContain('animate-spin')
    expect(updateButton.attributes('disabled')).toBeDefined()
  })

  it('starts completion polling before updating and reloads after the target server responds', async () => {
    vi.useFakeTimers()
    const targetVersion = '0.11.0'
    let timerWasActiveWhenUpdateStarted = false
    projectsMock.triggerServiceUpdate.mockImplementation(async () => {
      // The layout also owns the long-lived availability timer; completion owns
      // both its polling interval and bounded timeout.
      timerWasActiveWhenUpdateStarted = vi.getTimerCount() === 3
      const status = {
        enabled: true,
        updateAvailable: true,
        updating: true,
        installedVersion: '0.10.0',
        latestVersion: targetVersion
      }
      projectsMock.serviceUpdate.value = status
      return status
    })
    projectsMock.refreshServiceUpdate
      // Initial availability refresh performed by onMounted.
      .mockResolvedValueOnce(projectsMock.serviceUpdate.value)
      .mockRejectedValueOnce(new Error('service restarting'))
      .mockResolvedValueOnce({
        enabled: true,
        updateAvailable: true,
        updating: false,
        installedVersion: '0.10.0',
        latestVersion: targetVersion
      })
      .mockResolvedValueOnce({
        enabled: true,
        updateAvailable: false,
        updating: false,
        installedVersion: targetVersion,
        latestVersion: targetVersion
      })

    const wrapper = mountLayout()
    const updateButton = findUpdateTrigger(wrapper)
    await updateButton.trigger('click')
    await findButtonByText(wrapper, 'Update and restart')?.trigger('click')

    expect(timerWasActiveWhenUpdateStarted).toBe(true)

    await vi.advanceTimersByTimeAsync(2_000)
    expect(reloadPageMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)
    expect(reloadPageMock).toHaveBeenCalledTimes(1)
    // Successful completion clears only the short-lived watcher.
    expect(vi.getTimerCount()).toBe(1)

    wrapper.unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cleans up completion polling when the layout unmounts', async () => {
    vi.useFakeTimers()
    projectsMock.triggerServiceUpdate.mockResolvedValue({
      enabled: true,
      updateAvailable: true,
      updating: true,
      installedVersion: '0.10.0',
      latestVersion: '0.11.0'
    })

    const wrapper = mountLayout()
    await findUpdateTrigger(wrapper).trigger('click')
    await findButtonByText(wrapper, 'Update and restart')?.trigger('click')
    expect(vi.getTimerCount()).toBe(3)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(5_000)

    expect(vi.getTimerCount()).toBe(0)
    expect(reloadPageMock).not.toHaveBeenCalled()
  })
})

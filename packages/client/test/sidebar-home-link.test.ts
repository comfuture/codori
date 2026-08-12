// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const routeMock = vi.hoisted(() => ({
  path: '/projects/demo',
  fullPath: '/projects/demo'
}))

vi.mock('#imports', () => ({
  useRoute: () => routeMock
}))

vi.mock('../app/composables/useProjects', async () => {
  const { ref: createRef } = await import('vue')

  return {
    useProjects: () => ({
      serviceUpdate: createRef({
        enabled: true,
        updateAvailable: true,
        updating: false,
        installedVersion: '0.13.0',
        latestVersion: '0.13.1'
      }),
      serviceUpdatePending: createRef(false),
      refreshServiceUpdate: vi.fn(async () => undefined),
      triggerServiceUpdate: vi.fn(async () => undefined)
    })
  }
})

import DefaultLayout from '../app/layouts/default.vue'

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

const PassthroughStub = defineComponent({
  template: '<div><slot /></div>'
})

const NuxtLinkStub = defineComponent({
  inheritAttrs: false,
  props: {
    to: {
      type: String,
      default: ''
    }
  },
  template: '<a v-bind="$attrs" :href="to"><slot /></a>'
})

const sidebarStub = (collapsed: boolean) => defineComponent({
  setup() {
    return { collapsed }
  },
  template: `
    <div>
      <slot name="header" :collapsed="collapsed" />
      <slot />
      <slot name="footer" :collapsed="collapsed" />
    </div>
  `
})

const mountLayout = (collapsed = false) => mount(DefaultLayout, {
  global: {
    stubs: {
      UButton: ButtonStub,
      UModal: PassthroughStub,
      UTooltip: PassthroughStub,
      UIcon: PassthroughStub,
      UDashboardGroup: PassthroughStub,
      UDashboardSidebar: sidebarStub(collapsed),
      UDashboardSidebarCollapse: PassthroughStub,
      GlobalCommandPalette: PassthroughStub,
      ProjectSidebar: PassthroughStub,
      NuxtLink: NuxtLinkStub
    }
  }
})

describe('sidebar home link', () => {
  it('routes the expanded identity block to the landing screen', () => {
    const wrapper = mountLayout()
    const link = wrapper.get('[data-testid="sidebar-home-link"]')

    expect(link.attributes('href')).toBe('/')
    expect(link.attributes('aria-label')).toBe('Go to the Codori home screen')
    expect(link.text()).toContain('Codori')
    expect(link.classes().join(' ')).toContain('focus-visible:ring-2')
    expect(link.get('[data-testid="sidebar-brand-icon"]').attributes('src'))
      .toBe('/icons/codori-192.png')
    expect(link.get('[data-testid="sidebar-brand-icon"]').attributes('alt')).toBe('')

    // The service-update trigger must stay outside the link so its click is not
    // captured by navigation.
    const updateTrigger = wrapper.findAll('button').find((button) => {
      const text = button.text().trim()
      return text.startsWith('Update') && text !== 'Update and restart'
    })
    expect(updateTrigger).toBeDefined()
    expect(link.find('button').exists()).toBe(false)

    wrapper.unmount()
  })

  it('keeps an accessible name when the sidebar is collapsed', () => {
    const wrapper = mountLayout(true)
    const link = wrapper.get('[data-testid="sidebar-home-link"]')

    expect(link.attributes('href')).toBe('/')
    expect(link.attributes('aria-label')).toBe('Go to the Codori home screen')
    expect(link.get('.sr-only').text()).toContain('Codori')
    expect(link.get('[data-testid="sidebar-brand-icon"]').attributes('src'))
      .toBe('/icons/codori-192.png')

    wrapper.unmount()
  })
})

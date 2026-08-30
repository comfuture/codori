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

const CommandPaletteStub = defineComponent({
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  template: '<div data-testid="command-palette" :data-open="String(open)" />'
})

const KbdStub = defineComponent({
  props: {
    value: {
      type: String,
      default: ''
    }
  },
  template: '<kbd>{{ value }}</kbd>'
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
      UKbd: KbdStub,
      UDashboardGroup: PassthroughStub,
      UDashboardSidebar: sidebarStub(collapsed),
      UDashboardSidebarCollapse: PassthroughStub,
      GlobalCommandPalette: CommandPaletteStub,
      ProjectSidebar: PassthroughStub,
      NuxtLink: NuxtLinkStub
    }
  }
})

describe('sidebar home link', () => {
  it('routes the expanded identity block to the landing screen', async () => {
    const wrapper = mountLayout()
    const link = wrapper.get('[data-testid="sidebar-home-link"]')

    expect(link.attributes('href')).toBe('/')
    expect(link.attributes('aria-label')).toBe('Go to the Codori home screen')
    expect(link.text()).toContain('Codori')
    expect(link.text()).not.toContain('Codex project control')
    expect(link.classes().join(' ')).toContain('focus-visible:ring-2')
    expect(link.get('[data-testid="sidebar-brand-icon"]').attributes('src'))
      .toBe('/icons/codori-192.png')
    expect(link.get('[data-testid="sidebar-brand-icon"]').attributes('alt')).toBe('')

    const updateTrigger = wrapper.get('[data-testid="service-update-button"]')
    expect(updateTrigger.text().trim()).toBe('Update')
    expect(updateTrigger.attributes('color')).toBe('primary')
    expect(updateTrigger.attributes('aria-label')).toBe('Update Codori')
    expect(updateTrigger.find('[name="i-lucide-download"]').exists()).toBe(true)
    expect(updateTrigger.get('span').classes()).toEqual(['hidden', 'sm:inline'])
    expect(link.find('button').exists()).toBe(false)

    const search = wrapper.get('button[aria-label="Search Codori"]')
    expect(search.element.parentElement?.parentElement).toBe(link.element.parentElement)
    expect(search.attributes('variant')).toBe('outline')
    expect(search.attributes('icon')).toBe('i-lucide-search')
    expect(search.text()).toContain('Search')
    expect(search.text()).toMatch(/(?:meta|ctrl)K/u)
    expect(search.classes()).toContain('ms-auto')
    expect(wrapper.get('[data-testid="command-palette"]').attributes('data-open')).toBe('false')
    await search.trigger('click')
    expect(wrapper.get('[data-testid="command-palette"]').attributes('data-open')).toBe('true')

    wrapper.unmount()
  })

  it('keeps an accessible name when the sidebar is collapsed', () => {
    const wrapper = mountLayout(true)
    const link = wrapper.get('[data-testid="sidebar-home-link"]')

    expect(link.attributes('href')).toBe('/')
    expect(link.attributes('aria-label')).toBe('Go to the Codori home screen')
    expect(link.get('.sr-only').text()).toContain('Codori')
    expect(link.get('.sr-only').text()).not.toContain('Codex project control')
    expect(link.get('[data-testid="sidebar-brand-icon"]').attributes('src'))
      .toBe('/icons/codori-192.png')
    expect(wrapper.find('button[aria-label="Search Codori"]').exists()).toBe(false)
    const updateTrigger = wrapper.get('[data-testid="service-update-button"]')
    expect(updateTrigger.text().trim()).toBe('')
    expect(updateTrigger.find('[name="i-lucide-download"]').exists()).toBe(true)

    wrapper.unmount()
  })
})

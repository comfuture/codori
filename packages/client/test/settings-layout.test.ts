// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it, vi } from 'vitest'

const routeMock = vi.hoisted(() => ({
  path: '/settings/voice',
  query: {
    returnTo: '/projects/codori/threads/thread-1'
  }
}))

vi.mock('#imports', () => ({
  useRoute: () => routeMock
}))

import SettingsLayout from '../app/layouts/settings.vue'

const ButtonStub = defineComponent({
  props: {
    to: {
      type: [String, Object],
      default: undefined
    },
    label: {
      type: String,
      default: ''
    }
  },
  template: '<a :data-to="JSON.stringify(to)">{{ label }}<slot /></a>'
})

const NavigationStub = defineComponent({
  props: {
    items: {
      type: Array,
      default: () => []
    }
  },
  template: '<nav />'
})

describe('settings layout', () => {
  it('uses one section model for desktop and mobile and renders its page slot', () => {
    const wrapper = mount(SettingsLayout, {
      slots: {
        default: '<div data-testid="settings-page">Voice page</div>'
      },
      global: {
        stubs: {
          UButton: ButtonStub,
          UNavigationMenu: NavigationStub
        }
      }
    })

    const navigation = wrapper.findAllComponents(NavigationStub)
    expect(navigation).toHaveLength(2)
    for (const menu of navigation) {
      const items = menu.props('items') as Array<{
        label: string
        active: boolean
        to: {
          path: string
          query: {
            returnTo: string
          }
        }
      }>
      expect(items.map(item => item.label)).toEqual([
        'Notifications',
        'Voice',
        'Backend',
        'Workspace'
      ])
      expect(items.find(item => item.active)?.label).toBe('Voice')
      expect(items.every(item =>
        item.to.query.returnTo === '/projects/codori/threads/thread-1'
      )).toBe(true)
    }

    expect(wrapper.findAllComponents(ButtonStub).filter(button =>
      button.props('label') === 'Back to app'
      || button.attributes('aria-label') === 'Back to app'
    )).toHaveLength(2)
    expect(wrapper.get('[data-testid="settings-page"]').text()).toBe('Voice page')
  })
})

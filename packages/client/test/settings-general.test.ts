// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('#imports', () => ({
  definePageMeta: () => {}
}))

import AppearanceSettings from '../app/components/AppearanceSettings.client.vue'
import GeneralSettingsPage from '../app/pages/settings/general.vue'

const namedStub = (name: string) => defineComponent({
  name,
  setup(_, { attrs }) {
    return () => h('div', {
      'data-stub': name,
      'aria-labelledby': attrs['aria-labelledby'],
      'aria-describedby': attrs['aria-describedby']
    })
  }
})

describe('general settings', () => {
  it('owns workspace root and appearance in one section', () => {
    const wrapper = mount(GeneralSettingsPage, {
      global: {
        stubs: {
          ProjectRootSettings: namedStub('ProjectRootSettings'),
          AppearanceSettings: namedStub('AppearanceSettings')
        }
      }
    })

    expect(wrapper.get('h2').text()).toBe('General')
    expect(wrapper.find('[data-stub="ProjectRootSettings"]').exists()).toBe(true)
    expect(wrapper.find('[data-stub="AppearanceSettings"]').exists()).toBe(true)
  })

  it('uses the Nuxt UI color-mode select so system stays selectable', () => {
    const wrapper = mount(AppearanceSettings, {
      global: {
        stubs: {
          UColorModeSelect: namedStub('UColorModeSelect')
        }
      }
    })

    const control = wrapper.get('[data-stub="UColorModeSelect"]')
    expect(control.attributes('aria-labelledby')).toBe('appearance-color-mode-label')
    expect(control.attributes('aria-describedby')).toBe('appearance-color-mode-description')
    expect(wrapper.get('#appearance-color-mode-label').text()).toBe('Color mode')
    expect(wrapper.text()).toContain('follow your system appearance')
  })
})

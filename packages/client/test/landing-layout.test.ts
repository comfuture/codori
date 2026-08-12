// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { defineComponent, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../app/composables/useLandingRealtimeVoiceCompanion', () => ({
  useLandingRealtimeVoiceCompanion: () => ({
    pending: ref(false),
    error: ref(null),
    centeredPresentation: ref(false),
    activeSession: ref(false),
    start: vi.fn()
  })
}))

import LandingPage from '../app/pages/index.vue'

const DashboardPanelStub = defineComponent({
  inheritAttrs: false,
  props: {
    ui: {
      type: Object,
      default: () => ({})
    }
  },
  template: '<section v-bind="$attrs" :data-body-ui="ui.body"><slot name="header" /><div><slot name="body" /></div></section>'
})

describe('landing layout', () => {
  it('uses its dashboard body as the mobile scroll container', () => {
    const wrapper = mount(LandingPage, {
      global: {
        stubs: {
          UDashboardPanel: DashboardPanelStub,
          UDashboardNavbar: true,
          UAlert: true,
          UButton: true
        }
      }
    })

    const panel = wrapper.get('#landing-panel')
    expect(panel.classes()).toContain('min-h-0')
    expect(panel.classes()).not.toContain('min-h-screen')
    expect(panel.attributes('data-body-ui')).toContain('min-h-0')
    expect(panel.attributes('data-body-ui')).toContain('overflow-y-auto')
    expect(panel.attributes('data-body-ui')).toContain('overscroll-contain')
    expect(wrapper.text()).not.toContain('Remote coding')
    expect(wrapper.text()).not.toContain('Codori selects one shared Codex app-server backend')
  })
})

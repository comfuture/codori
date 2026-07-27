// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import App from '../app/app.vue'

const AppRootStub = defineComponent({
  template: '<div data-testid="app-root"><slot /></div>'
})

const NuxtLayoutStub = defineComponent({
  template: '<div data-testid="layout"><slot /></div>'
})

const ActivityNotificationsStub = defineComponent({
  template: '<div data-testid="activity-notifications" />'
})

const GlobalRealtimeVoiceCompanionStub = defineComponent({
  template: '<div data-testid="voice-companion" />'
})

describe('app shell lifecycle', () => {
  it('mounts each global coordinator once outside the route layout', () => {
    const wrapper = mount(App, {
      global: {
        stubs: {
          UApp: AppRootStub,
          NuxtLayout: NuxtLayoutStub,
          NuxtPage: true,
          ActivityNotifications: ActivityNotificationsStub,
          GlobalRealtimeVoiceCompanion: GlobalRealtimeVoiceCompanionStub
        }
      }
    })

    expect(wrapper.findAll('[data-testid="activity-notifications"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="voice-companion"]')).toHaveLength(1)
    const layout = wrapper.get('[data-testid="layout"]')
    expect(layout.find('[data-testid="activity-notifications"]').exists()).toBe(false)
    expect(layout.find('[data-testid="voice-companion"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

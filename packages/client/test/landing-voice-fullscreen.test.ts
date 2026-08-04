// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import LandingVoiceFullscreen from '../app/components/LandingVoiceFullscreen.vue'

const ButtonStub = defineComponent({
  inheritAttrs: false,
  emits: ['click'],
  template: '<button v-bind="$attrs" @click="$emit(\'click\')">{{ $attrs.label }}</button>'
})

describe('LandingVoiceFullscreen', () => {
  it('covers the viewport with a four-color backdrop and an exit action', async () => {
    const wrapper = mount(LandingVoiceFullscreen, {
      global: {
        stubs: {
          UButton: ButtonStub
        }
      }
    })

    const fullscreen = wrapper.get('[data-testid="landing-voice-fullscreen"]')
    expect(fullscreen.classes()).toContain('fixed')
    expect(fullscreen.classes()).toContain('inset-0')
    expect(fullscreen.attributes('aria-modal')).toBe('true')
    expect(wrapper.find('[data-testid="landing-voice-gradient"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="landing-voice-pointer-highlight"]').exists()).toBe(true)

    window.dispatchEvent(new PointerEvent('pointermove', {
      clientX: 320,
      clientY: 180
    }))
    const fullscreenElement = fullscreen.element as HTMLElement
    expect(fullscreenElement.style.getPropertyValue('--pointer-x')).toBe('320px')
    expect(fullscreenElement.style.getPropertyValue('--pointer-y')).toBe('180px')

    await wrapper.get('button[aria-label="Exit voice companion"]').trigger('click')
    expect(wrapper.emitted('exit')).toHaveLength(1)
    wrapper.unmount()
  })
})

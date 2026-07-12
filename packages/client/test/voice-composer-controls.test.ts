// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import VoiceComposerControls from '../app/components/VoiceComposerControls.vue'
import type {
  RealtimeActivity,
  RealtimeCapability,
  RealtimeSessionState
} from '../app/composables/useRealtimeConversation'

const ButtonStub = defineComponent({
  inheritAttrs: false,
  template: '<button v-bind="$attrs"><slot /></button>'
})

const TooltipStub = defineComponent({
  template: '<div><slot /></div>'
})

type VoiceProps = {
  capability: RealtimeCapability
  sessionState: RealtimeSessionState
  activity: RealtimeActivity
  microphoneEnabled: boolean
  outputMuted: boolean
  autoplayBlocked: boolean
  latestUserTranscript: string | null
  error: string | null
}

const baseProps: VoiceProps = {
  capability: {
    status: 'available' as const,
    message: 'Realtime voice is available.'
  },
  sessionState: 'connected' as const,
  activity: 'idle' as const,
  microphoneEnabled: false,
  outputMuted: false,
  autoplayBlocked: false,
  latestUserTranscript: null,
  error: null
}

const mountControls = (props: Partial<VoiceProps> = {}) =>
  mount(VoiceComposerControls, {
    props: {
      ...baseProps,
      ...props
    },
    global: {
      stubs: {
        UButton: ButtonStub,
        UTooltip: TooltipStub
      }
    }
  })

const dispatchPointer = async (
  element: Element,
  type: string,
  input: { pointerId: number, pointerType?: string, button?: number }
) => {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: input.button ?? 0
  })
  Object.defineProperty(event, 'pointerId', { value: input.pointerId })
  Object.defineProperty(event, 'pointerType', { value: input.pointerType ?? 'mouse' })
  element.dispatchEvent(event)
  await nextTick()
}

const dispatchScreenReaderClick = async (element: Element) => {
  element.dispatchEvent(new MouseEvent('click', {
    bubbles: true,
    cancelable: true,
    detail: 0
  }))
  await nextTick()
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible'
  })
})

describe('VoiceComposerControls', () => {
  it('exposes accessible ready and transcript status', async () => {
    const wrapper = mountControls({
      latestUserTranscript: 'Run the focused tests'
    })

    const microphone = wrapper.get('button[aria-label="Hold to talk"]')
    expect(microphone.attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Voice ready')
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Heard: Run the focused tests')

    await wrapper.setProps({ activity: 'delegating' })
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Delegating to Codex')
    wrapper.unmount()
  })

  it('holds to transmit and releases on pointer completion without a click toggle', async () => {
    const wrapper = mountControls()
    const microphone = wrapper.get('button[aria-label="Hold to talk"]')

    await dispatchPointer(microphone.element, 'pointerdown', {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0
    })
    await dispatchPointer(microphone.element, 'pointerup', {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0
    })
    microphone.element.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await nextTick()

    expect(wrapper.emitted('press')).toHaveLength(1)
    expect(wrapper.emitted('release')).toHaveLength(1)
    wrapper.unmount()
  })

  it('cancels transmission for pointer cancel and lost capture', async () => {
    const wrapper = mountControls()
    const microphone = wrapper.get('button[aria-label="Hold to talk"]')

    await dispatchPointer(microphone.element, 'pointerdown', { pointerId: 1, pointerType: 'touch' })
    await dispatchPointer(microphone.element, 'pointercancel', { pointerId: 1, pointerType: 'touch' })
    await dispatchPointer(microphone.element, 'pointerdown', { pointerId: 2 })
    await dispatchPointer(microphone.element, 'lostpointercapture', { pointerId: 2 })

    expect(wrapper.emitted('press')).toHaveLength(2)
    expect(wrapper.emitted('release')).toHaveLength(2)
    wrapper.unmount()
  })

  it('keeps a held first gesture pending until the session connects', async () => {
    const wrapper = mountControls({ sessionState: 'idle' })
    const microphone = wrapper.get('button[aria-label="Start voice session"]')

    await dispatchPointer(microphone.element, 'pointerdown', { pointerId: 3 })
    expect(wrapper.emitted('connect')).toHaveLength(1)
    expect(wrapper.emitted('press')).toBeUndefined()

    await wrapper.setProps({ sessionState: 'connected' })
    await nextTick()
    expect(wrapper.emitted('press')).toHaveLength(1)

    await dispatchPointer(microphone.element, 'pointerup', { pointerId: 3 })
    expect(wrapper.emitted('release')).toHaveLength(1)
    wrapper.unmount()
  })

  it('uses focused Space and Enter only while releasing through the window', async () => {
    const wrapper = mountControls()
    const microphone = wrapper.get('button[aria-label="Hold to talk"]')

    await microphone.trigger('keydown', { key: ' ', repeat: false })
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }))
    await nextTick()
    await microphone.trigger('keydown', { key: 'Enter', repeat: false })
    await microphone.trigger('keydown', { key: 'Enter', repeat: true })
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    await nextTick()

    expect(wrapper.emitted('press')).toHaveLength(2)
    expect(wrapper.emitted('release')).toHaveLength(2)
    wrapper.unmount()
  })

  it('supports screen-reader click toggling and focus/visibility safety release', async () => {
    const wrapper = mountControls()
    const microphone = wrapper.get('button[aria-label="Hold to talk"]')

    await dispatchScreenReaderClick(microphone.element)
    expect(wrapper.emitted('press')).toHaveLength(1)

    window.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(wrapper.emitted('release')).toHaveLength(1)

    await dispatchScreenReaderClick(microphone.element)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    document.dispatchEvent(new Event('visibilitychange'))
    await nextTick()
    expect(wrapper.emitted('release')).toHaveLength(2)
    wrapper.unmount()
  })

  it('offers separate output and stop actions with autoplay guidance', async () => {
    const wrapper = mountControls({ autoplayBlocked: true })
    const output = wrapper.get('button[aria-label="Play and unmute remote speech"]')
    const stop = wrapper.get('button[aria-label="Stop voice session"]')

    await output.trigger('click')
    await stop.trigger('click')

    expect(wrapper.emitted('toggle-output')).toHaveLength(1)
    expect(wrapper.emitted('stop')).toHaveLength(1)
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Remote speech is blocked')
    wrapper.unmount()
  })

  it('renders disabled, insecure, and error capability messages', async () => {
    const wrapper = mountControls({
      capability: {
        status: 'disabled',
        message: 'Experimental realtime voice is disabled in Codori.'
      },
      sessionState: 'idle'
    })

    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('disabled in Codori')

    await wrapper.setProps({
      capability: {
        status: 'insecure-context',
        message: 'Voice requires localhost or a secure HTTPS connection.'
      }
    })
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('secure HTTPS')

    await wrapper.setProps({
      capability: baseProps.capability,
      sessionState: 'error',
      error: 'Microphone permission was denied'
    })
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('permission was denied')
    wrapper.unmount()
  })
})

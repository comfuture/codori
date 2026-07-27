// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import VoiceComposerControls from '../app/components/VoiceComposerControls.vue'
import type {
  RealtimeActivity,
  RealtimeCapability,
  RealtimeSessionKind,
  RealtimeSessionState
} from '../app/composables/useRealtimeConversation'

const ButtonStub = defineComponent({
  inheritAttrs: false,
  template: '<button v-bind="$attrs"><slot /></button>'
})

const TooltipStub = defineComponent({
  props: {
    text: {
      type: String,
      required: true
    }
  },
  template: '<div class="tooltip-stub" :data-tooltip="text"><slot /></div>'
})

type VoiceProps = {
  capability: RealtimeCapability
  sessionState: RealtimeSessionState
  activity: RealtimeActivity
  microphoneEnabled: boolean
  outputMuted: boolean
  autoplayBlocked: boolean
  error: string | null
  activeElsewhere: boolean
  sessionKind: RealtimeSessionKind | null
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
  error: null,
  activeElsewhere: false,
  sessionKind: 'conversation'
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

describe('VoiceComposerControls', () => {
  it('exposes accessible toggle state with a stable audio-lines icon', async () => {
    const wrapper = mountControls()

    const microphone = wrapper.get('button[aria-label="Activate microphone"]')
    expect(microphone.attributes('aria-pressed')).toBe('false')
    expect(microphone.attributes('icon')).toBe('i-lucide-audio-lines')
    expect(microphone.attributes('color')).toBe('neutral')
    expect(microphone.attributes('variant')).toBe('ghost')
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Voice ready')

    await wrapper.setProps({
      activity: 'listening',
      microphoneEnabled: true
    })
    const activeMicrophone = wrapper.get('button[aria-label="Deactivate microphone"]')
    expect(activeMicrophone.attributes('aria-pressed')).toBe('true')
    expect(activeMicrophone.attributes('icon')).toBe('i-lucide-audio-lines')
    expect(activeMicrophone.attributes('color')).toBe('primary')
    expect(activeMicrophone.attributes('variant')).toBe('soft')
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('Listening')
    wrapper.unmount()
  })

  it('toggles the connected microphone with each click', async () => {
    const wrapper = mountControls()
    await wrapper.get('button[aria-label="Activate microphone"]').trigger('click')
    expect(wrapper.emitted('toggle-microphone')).toHaveLength(1)

    await wrapper.setProps({ microphoneEnabled: true })
    await wrapper.get('button[aria-label="Deactivate microphone"]').trigger('click')
    expect(wrapper.emitted('toggle-microphone')).toHaveLength(2)
    wrapper.unmount()
  })

  it('starts a voice session from idle and disables repeat clicks while connecting', async () => {
    const wrapper = mountControls({ sessionState: 'idle' })
    const microphone = wrapper.get('button[aria-label="Start voice session and activate microphone"]')

    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(false)
    await microphone.trigger('click')
    expect(wrapper.emitted('connect')).toHaveLength(1)

    await wrapper.setProps({ sessionState: 'starting' })
    const connectingMicrophone = wrapper.get('button[aria-label="Voice session is connecting"]')
    expect(connectingMicrophone.attributes('disabled')).toBeDefined()
    await connectingMicrophone.trigger('click')
    expect(wrapper.emitted('connect')).toHaveLength(1)
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

  it('keeps persistent voice selection out of the composer', () => {
    const wrapper = mountControls()

    expect(wrapper.find('[aria-label="Choose realtime voice"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Codex setting')
    expect(wrapper.findAll('button')).toHaveLength(3)
    wrapper.unmount()
  })

  it('blocks starting another voice session while keeping the global stop action', async () => {
    const wrapper = mountControls({
      sessionState: 'idle',
      activeElsewhere: true
    })

    const microphone = wrapper.get('button[aria-label="A voice session is already active in another thread"]')
    expect(microphone.attributes('disabled')).toBeDefined()
    expect(wrapper.find('button[aria-label="Stop voice session"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Mute remote speech"]').exists()).toBe(false)
    expect(wrapper.get('[aria-live="polite"]').text()).toContain('another thread')

    await microphone.trigger('click')
    expect(wrapper.emitted('connect')).toBeUndefined()
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

    const unavailableMicrophone = wrapper.get('button')
    expect(unavailableMicrophone.attributes('disabled')).toBeDefined()
    expect(unavailableMicrophone.attributes('color')).toBe('error')
    expect(unavailableMicrophone.attributes('icon')).toBe('i-lucide-mic-off')
    expect(wrapper.get('[data-tooltip]').attributes('data-tooltip')).toContain('disabled in Codori')
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(false)

    await wrapper.setProps({
      capability: {
        status: 'insecure-context',
        message: 'Voice requires localhost or a secure HTTPS connection.'
      }
    })
    expect(wrapper.get('[data-tooltip]').attributes('data-tooltip')).toContain('secure HTTPS')

    await wrapper.setProps({
      capability: baseProps.capability,
      sessionState: 'error',
      error: 'Microphone permission was denied'
    })
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('button').attributes('color')).toBe('error')
    expect(wrapper.get('[data-tooltip]').attributes('data-tooltip')).toContain('permission was denied')
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

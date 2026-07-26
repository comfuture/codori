// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import RealtimeVoicePicker from '../app/components/RealtimeVoicePicker.vue'
import type {
  RealtimeSessionKind,
  RealtimeSessionState,
  RealtimeCapability,
  RealtimeVoiceCatalog,
  RealtimeVoicePreviewStatus
} from '../app/composables/useRealtimeConversation'
import type { RealtimeVoice } from '../shared/generated/codex-app-server/RealtimeVoice'

const UPopoverStub = defineComponent({
  setup(_props, { slots }) {
    return () => h('div', [
      slots.default?.(),
      slots.content?.()
    ])
  }
})

const ButtonStub = defineComponent({
  inheritAttrs: false,
  template: '<button v-bind="$attrs"><slot /></button>'
})

const TooltipStub = defineComponent({
  template: '<span><slot /></span>'
})

const IconStub = defineComponent({
  template: '<i />'
})

type PickerProps = {
  capability: RealtimeCapability
  catalog: RealtimeVoiceCatalog
  selectedVoice?: RealtimeVoice
  savedVoice: string | null
  sessionKind: RealtimeSessionKind | null
  sessionState: RealtimeSessionState
  activeVoice: RealtimeVoice | null
  previewStatus: RealtimeVoicePreviewStatus
  previewError: string | null
  activeElsewhere: boolean
  hasMaterializedThread: boolean
}

const baseProps: PickerProps = {
  capability: {
    status: 'available',
    message: 'Realtime voice is available.'
  },
  catalog: {
    status: 'ready' as const,
    voices: ['juniper', 'cove'],
    protocolDefault: 'cove',
    error: null
  },
  selectedVoice: undefined,
  savedVoice: null,
  sessionKind: null,
  sessionState: 'idle' as const,
  activeVoice: null,
  previewStatus: 'idle' as const,
  previewError: null,
  activeElsewhere: false,
  hasMaterializedThread: true
}

const mountPicker = (props: Partial<PickerProps> = {}) =>
  mount(RealtimeVoicePicker, {
    props: {
      ...baseProps,
      ...props
    },
    global: {
      stubs: {
        UPopover: UPopoverStub,
        UButton: ButtonStub,
        UTooltip: TooltipStub,
        UIcon: IconStub
      }
    }
  })

describe('RealtimeVoicePicker', () => {
  it('keeps the Codex setting distinct from the protocol default', async () => {
    const wrapper = mountPicker()

    expect(wrapper.text()).toContain('Use Codex setting')
    expect(wrapper.text()).toContain('cove')
    expect(wrapper.text()).toContain('Protocol default')

    const codexSetting = wrapper.get('input[type="radio"][value=""]')
    expect((codexSetting.element as HTMLInputElement).checked).toBe(true)
    await codexSetting.trigger('change')
    expect(wrapper.emitted('select')?.at(-1)).toEqual([null])

    const cove = wrapper.get('input[type="radio"][value="cove"]')
    await cove.trigger('change')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['cove'])

    const names = wrapper.findAll('input[type="radio"]').map(input => input.attributes('name'))
    expect(new Set(names).size).toBe(1)

    await cove.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('select')?.at(-1)).toEqual([null])
    expect(codexSetting.attributes('tabindex')).toBe('0')
    expect(cove.attributes('tabindex')).toBe('-1')
  })

  it('offers exact accessible preview controls without microphone fallback', async () => {
    const wrapper = mountPicker()

    await wrapper.get('button[aria-label="Preview voice juniper"]').trigger('click')
    expect(wrapper.emitted('preview')?.at(-1)).toEqual(['juniper'])

    await wrapper.setProps({
      sessionKind: 'preview',
      sessionState: 'connected',
      activeVoice: 'juniper',
      previewStatus: 'playing'
    })
    await wrapper.get('button[aria-label="Stop preview for juniper"]').trigger('click')
    expect(wrapper.emitted('stop-preview')).toHaveLength(1)
    expect(wrapper.text()).toContain('Playing juniper preview')
  })

  it('preserves and explains an unavailable saved choice', () => {
    const wrapper = mountPicker({
      savedVoice: 'shimmer'
    })

    expect(wrapper.text()).toContain('Saved voice “shimmer” is not advertised')
    expect(wrapper.text()).toContain('Codex settings will be used')
    expect((wrapper.get('input[type="radio"][value=""]').element as HTMLInputElement).checked)
      .toBe(true)
  })

  it('disables preview during a normal session and for provisional threads', async () => {
    const wrapper = mountPicker({
      sessionKind: 'conversation',
      sessionState: 'connected'
    })

    expect(wrapper.get('button[aria-label="Preview voice cove"]').attributes('disabled'))
      .toBeDefined()

    await wrapper.setProps({
      sessionKind: null,
      sessionState: 'idle',
      hasMaterializedThread: false
    })
    expect(wrapper.text()).toContain('Open an existing thread')
    expect(wrapper.get('button[aria-label="Preview voice cove"]').attributes('disabled'))
      .toBeDefined()
  })

  it('explains why voice discovery is unavailable', () => {
    const wrapper = mountPicker({
      capability: {
        status: 'disabled',
        message: 'Experimental realtime voice is disabled in Codori.'
      }
    })

    expect(wrapper.get('button[aria-label="Choose realtime voice"]').attributes('disabled'))
      .toBeDefined()
    expect(wrapper.text()).toContain('disabled in Codori')
  })

  it('offers an explicit discovery retry and avoids a premature stale warning', async () => {
    const loading = mountPicker({
      catalog: {
        status: 'loading',
        voices: [],
        protocolDefault: null,
        error: null
      },
      savedVoice: 'shimmer'
    })
    expect(loading.text()).not.toContain('not advertised')

    const failed = mountPicker({
      catalog: {
        status: 'error',
        voices: [],
        protocolDefault: null,
        error: 'Could not load realtime voices: disconnected'
      },
      savedVoice: 'shimmer'
    })
    expect(failed.text()).not.toContain('not advertised')
    await failed.get('button[aria-label="Retry loading realtime voices"]').trigger('click')
    expect(failed.emitted('refresh')).toHaveLength(1)
  })
})

// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import RealtimeVoiceSettings from '../app/components/RealtimeVoiceSettings.vue'
import type {
  RealtimeSessionKind,
  RealtimeSessionState,
  RealtimeCapability,
  RealtimeVoiceCatalog,
  RealtimeVoicePreviewStatus
} from '../app/composables/useRealtimeConversation'
import type { RealtimeVoice } from '../shared/generated/codex-app-server/RealtimeVoice'

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    label: {
      type: String,
      default: ''
    }
  },
  template: '<button v-bind="$attrs">{{ label }}<slot /></button>'
})

const TooltipStub = defineComponent({
  template: '<span><slot /></span>'
})

const IconStub = defineComponent({
  template: '<i />'
})

const BadgeStub = defineComponent({
  template: '<span><slot /></span>'
})

type SettingsProps = {
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
  hasWorkspaceContext: boolean
}

const baseProps: SettingsProps = {
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
  hasWorkspaceContext: true
}

const mountSettings = (props: Partial<SettingsProps> = {}) =>
  mount(RealtimeVoiceSettings, {
    props: {
      ...baseProps,
      ...props
    },
    global: {
      stubs: {
        UButton: ButtonStub,
        UTooltip: TooltipStub,
        UIcon: IconStub,
        UBadge: BadgeStub
      }
    }
  })

describe('RealtimeVoiceSettings', () => {
  it('keeps the Codex setting distinct from the protocol default', async () => {
    const wrapper = mountSettings()

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
    const wrapper = mountSettings()

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
    const wrapper = mountSettings({
      savedVoice: 'shimmer'
    })

    expect(wrapper.text()).toContain('Saved voice “shimmer” is not advertised')
    expect(wrapper.text()).toContain('Codex settings will be used')
    expect((wrapper.get('input[type="radio"][value=""]').element as HTMLInputElement).checked)
      .toBe(true)
  })

  it('disables preview during a normal session but keeps local preview available without a remembered thread', async () => {
    const wrapper = mountSettings({
      sessionKind: 'conversation',
      sessionState: 'connected'
    })

    expect(wrapper.get('button[aria-label="Preview voice cove"]').attributes('disabled'))
      .toBeDefined()

    await wrapper.setProps({
      sessionKind: null,
      sessionState: 'idle',
      hasWorkspaceContext: false
    })
    expect(wrapper.text()).toContain('server availability check requires an existing thread')
    expect(wrapper.get('button[aria-label="Preview voice cove"]').attributes('disabled'))
      .toBeUndefined()
    await wrapper.get('button[aria-label="Preview voice cove"]').trigger('click')
    expect(wrapper.emitted('preview')?.at(-1)).toEqual(['cove'])

    const cove = wrapper.get('input[type="radio"][value="cove"]')
    await cove.trigger('change')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['cove'])
  })

  it('offers the built-in voice list before workspace discovery', async () => {
    const wrapper = mountSettings({
      hasWorkspaceContext: false,
      catalog: {
        status: 'idle',
        voices: [],
        protocolDefault: null,
        error: null
      }
    })

    expect(wrapper.text()).toContain('Showing Codex-compatible voices')
    const shimmer = wrapper.get('input[type="radio"][value="shimmer"]')
    await shimmer.trigger('change')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['shimmer'])
  })

  it('explains why voice discovery is unavailable without blocking preference changes', async () => {
    const wrapper = mountSettings({
      capability: {
        status: 'disabled',
        message: 'Experimental realtime voice is disabled in Codori.'
      }
    })

    expect(wrapper.text()).toContain('disabled in Codori')
    const cove = wrapper.get('input[type="radio"][value="cove"]')
    await cove.trigger('change')
    expect(wrapper.emitted('select')?.at(-1)).toEqual(['cove'])
  })

  it('offers an explicit discovery retry and avoids a premature stale warning', async () => {
    const loading = mountSettings({
      catalog: {
        status: 'loading',
        voices: [],
        protocolDefault: null,
        error: null
      },
      savedVoice: 'shimmer'
    })
    expect(loading.text()).not.toContain('not advertised')

    const failed = mountSettings({
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

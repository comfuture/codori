// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import RealtimeVoicePromptSettings from '../app/components/RealtimeVoicePromptSettings.vue'
import { DEFAULT_REALTIME_VOICE_PROMPT } from '../app/composables/useRealtimeVoicePreference'

const TextareaStub = defineComponent({
  props: {
    modelValue: {
      type: String,
      default: ''
    }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('textarea', {
      value: props.modelValue,
      onInput: (event: Event) =>
        emit('update:modelValue', (event.target as HTMLTextAreaElement).value)
    })
  }
})

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

const mountSettings = (props: {
  configuredPrompt: string | null
  promptOverride: string | null
  loading?: boolean
  error?: string | null
}) => mount(RealtimeVoicePromptSettings, {
  props: {
    loading: false,
    error: null,
    ...props
  },
  global: {
    stubs: {
      UBadge: true,
      UButton: ButtonStub,
      UIcon: true,
      UTextarea: TextareaStub
    }
  }
})

describe('RealtimeVoicePromptSettings', () => {
  it('shows the Codori prompt when config.toml has no value', () => {
    const wrapper = mountSettings({
      configuredPrompt: null,
      promptOverride: null
    })

    expect(wrapper.text()).toContain('Codori default')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value)
      .toBe(DEFAULT_REALTIME_VOICE_PROMPT)
  })

  it('starts from config.toml and saves a browser override', async () => {
    const wrapper = mountSettings({
      configuredPrompt: 'Configured prompt',
      promptOverride: null
    })

    expect(wrapper.text()).toContain('config.toml')
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value)
      .toBe('Configured prompt')

    await wrapper.get('textarea').setValue('Browser prompt')
    await wrapper.findAll('button')
      .find(button => button.text() === 'Save browser override')!
      .trigger('click')
    expect(wrapper.emitted('save')?.at(-1)).toEqual(['Browser prompt'])
  })

  it('preserves edits made while config.toml is loading', async () => {
    const wrapper = mountSettings({
      configuredPrompt: null,
      promptOverride: null,
      loading: true
    })

    await wrapper.get('textarea').setValue('Draft typed during loading')
    await wrapper.setProps({
      configuredPrompt: 'Configured prompt',
      loading: false
    })

    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value)
      .toBe('Draft typed during loading')
  })

  it('synchronizes an untouched draft after config.toml loads', async () => {
    const wrapper = mountSettings({
      configuredPrompt: null,
      promptOverride: null,
      loading: true
    })

    await wrapper.setProps({
      configuredPrompt: 'Configured prompt',
      loading: false
    })

    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value)
      .toBe('Configured prompt')
  })

  it('clears a browser override back to the configured prompt', async () => {
    const wrapper = mountSettings({
      configuredPrompt: 'Configured prompt',
      promptOverride: 'Browser prompt'
    })

    expect(wrapper.text()).toContain('Browser override')
    await wrapper.findAll('button')
      .find(button => button.text() === 'Use config.toml')!
      .trigger('click')
    expect(wrapper.emitted('clear')).toHaveLength(1)
    expect((wrapper.get('textarea').element as HTMLTextAreaElement).value)
      .toBe('Configured prompt')
  })
})

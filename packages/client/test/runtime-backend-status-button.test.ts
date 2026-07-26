// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import RuntimeBackendStatusButton from '../app/components/RuntimeBackendStatusButton.client.vue'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('ofetch', () => ({
  $fetch: fetchMock
}))

const PopoverStub = defineComponent({
  setup(_props, { slots }) {
    return () => h('div', [
      slots.default?.(),
      slots.content?.()
    ])
  }
})

const TooltipStub = defineComponent({
  template: '<span><slot /></span>'
})

const ButtonStub = defineComponent({
  inheritAttrs: false,
  template: '<button v-bind="$attrs" />'
})

const mountStatus = () => mount(RuntimeBackendStatusButton, {
  global: {
    stubs: {
      UPopover: PopoverStub,
      UTooltip: TooltipStub,
      UButton: ButtonStub
    }
  }
})

afterEach(() => {
  fetchMock.mockReset()
})

describe('RuntimeBackendStatusButton', () => {
  it('shows a ready first-party daemon without exposing its socket path', async () => {
    fetchMock.mockResolvedValue({
      backend: {
        backend: 'codex-daemon',
        transport: 'unix-socket',
        state: 'ready',
        version: '0.145.0',
        fallbackReason: null
      }
    })

    const wrapper = mountStatus()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/runtime\/backend$/)
    )
    expect(wrapper.get('button').attributes('aria-label'))
      .toBe('Runtime backend: Codex daemon · Unix socket')
    expect(wrapper.text()).toContain('First-party Codex')
    expect(wrapper.text()).toContain('Unix socket')
    expect(wrapper.text()).toContain('0.145.0')
    expect(wrapper.text()).not.toContain('app-server-control.sock')

    wrapper.unmount()
  })

  it('explains a managed fallback and remains read-only', async () => {
    fetchMock.mockResolvedValue({
      backend: {
        backend: 'codori-managed',
        transport: 'tcp-websocket',
        state: 'fallback',
        version: null,
        fallbackReason: 'incompatible-realtime'
      }
    })

    const wrapper = mountStatus()
    await flushPromises()

    expect(wrapper.get('button').attributes('aria-label'))
      .toBe('Runtime backend: Codori fallback · Local WebSocket')
    expect(wrapper.text()).toContain('Fallback')
    expect(wrapper.text()).toContain(
      'The daemon lacks the configured realtime voice capability.'
    )
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)

    wrapper.unmount()
  })
})

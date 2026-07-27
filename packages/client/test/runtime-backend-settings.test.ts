// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file */
import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import RuntimeBackendSettings from '../app/components/RuntimeBackendSettings.client.vue'

const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('ofetch', () => ({
  $fetch: fetchMock
}))

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

const BadgeStub = defineComponent({
  template: '<span><slot /></span>'
})

const mountStatus = () => mount(RuntimeBackendSettings, {
  global: {
    stubs: {
      UButton: ButtonStub,
      UBadge: BadgeStub
    }
  }
})

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: 'visible'
  })
})

afterEach(() => {
  fetchMock.mockReset()
  vi.useRealTimers()
})

describe('RuntimeBackendSettings', () => {
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
    expect(wrapper.text()).toContain('Codex daemon · Unix socket')
    expect(wrapper.text()).toContain('Ready')
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

    expect(wrapper.text()).toContain('Codori fallback · Local WebSocket')
    expect(wrapper.text()).toContain('Fallback')
    expect(wrapper.text()).toContain(
      'The daemon lacks the configured realtime voice capability.'
    )
    expect(wrapper.find('input').exists()).toBe(false)
    expect(wrapper.find('select').exists()).toBe(false)

    wrapper.unmount()
  })

  it('refreshes only while visible and cleans up timers and focus listeners', async () => {
    fetchMock.mockResolvedValue({
      backend: {
        backend: null,
        transport: null,
        state: 'idle',
        version: null,
        fallbackReason: null
      }
    })

    const wrapper = mountStatus()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(15_000)
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    await vi.advanceTimersByTimeAsync(15_000)
    window.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(3)

    wrapper.unmount()
    await vi.advanceTimersByTimeAsync(15_000)
    window.dispatchEvent(new Event('focus'))
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('keeps the last safe status when a later refresh fails', async () => {
    fetchMock
      .mockResolvedValueOnce({
        backend: {
          backend: 'codex-daemon',
          transport: 'unix-socket',
          state: 'ready',
          version: '0.145.0',
          fallbackReason: null
        }
      })
      .mockRejectedValueOnce(new Error('offline'))

    const wrapper = mountStatus()
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('First-party Codex')
    expect(wrapper.text()).toContain('Backend status is temporarily unavailable.')
    wrapper.unmount()
  })
})

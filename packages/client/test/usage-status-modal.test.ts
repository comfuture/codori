/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UsageStatusModal from '../app/components/UsageStatusModal.vue'

const mockRequest = vi.fn()
const mockSubscribe = vi.fn()
const mockRefreshProjects = vi.fn()
const mockStartProject = vi.fn()
const mockGetProject = vi.fn()
const mockLoaded = ref(true)

vi.mock('../app/composables/useRpc', () => ({
  useRpc: () => ({
    getClient: () => ({
      request: mockRequest,
      subscribe: mockSubscribe
    })
  })
}))

vi.mock('../app/composables/useProjects', () => ({
  useProjects: () => ({
    loaded: mockLoaded,
    refreshProjects: mockRefreshProjects,
    getProject: mockGetProject,
    startProject: mockStartProject
  })
}))

const ModalStub = defineComponent({
  name: 'ModalStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  setup(props, { slots }) {
    return () => props.open
      ? h('div', { class: 'modal-stub' }, [
          h('div', { class: 'modal-body' }, slots.body?.())
        ])
      : null
  }
})

const AlertStub = defineComponent({
  name: 'AlertStub',
  props: {
    title: {
      type: String,
      default: ''
    }
  },
  setup(props) {
    return () => h('div', { class: 'alert-stub' }, props.title)
  }
})

const mountModal = (props: Record<string, unknown>) =>
  mount(UsageStatusModal, {
    props: {
      projectId: 'codori',
      ...props
    },
    global: {
      stubs: {
        UModal: ModalStub,
        UAlert: AlertStub
      }
    }
  })

describe('usage status modal', () => {
  beforeEach(() => {
    mockLoaded.value = true
    mockRequest.mockReset()
    mockSubscribe.mockReset()
    mockRefreshProjects.mockReset()
    mockStartProject.mockReset()
    mockGetProject.mockReset()

    mockSubscribe.mockReturnValue(vi.fn())
    mockGetProject.mockReturnValue({ status: 'running' })
  })

  it('renders loading and empty states compactly', async () => {
    let resolveRequest: (value: unknown) => void = () => {}
    mockRequest.mockReturnValue(new Promise((resolve) => {
      resolveRequest = resolve as (value: unknown) => void
    }))

    const wrapper = mountModal({
      open: true
    })

    expect(wrapper.text()).toContain('Loading current quota windows...')

    resolveRequest([])
    await flushPromises()

    expect(wrapper.text()).toContain('No live quota windows were reported.')
  })

  it('renders stacked quota windows with reset timestamps', async () => {
    mockRequest.mockResolvedValue([{
      limitId: 'gpt-5',
      limitName: 'GPT-5',
      primary: {
        usedPercent: 72,
        resetsAt: '2026-04-15T12:00:00.000Z',
        windowDurationMins: 300
      },
      secondary: {
        usedPercent: 45,
        resetsAt: '2026-04-20T00:00:00.000Z',
        windowDurationMins: 10080
      }
    }])

    const wrapper = mountModal({
      open: true
    })

    await flushPromises()

    expect(wrapper.text()).toContain('GPT-5')
    expect(wrapper.text()).toContain('5h window')
    expect(wrapper.text()).toContain('1w window')
    expect(wrapper.text()).toContain('28% remaining')
    expect(wrapper.text()).toContain('55% remaining')
    expect(wrapper.text()).toContain('Next reset')
    expect(wrapper.findAll('time').map(node => node.attributes('datetime'))).toEqual([
      '2026-04-15T12:00:00.000Z',
      '2026-04-20T00:00:00.000Z'
    ])
  })

  it('hides next reset rows when the API does not provide reset timestamps', async () => {
    mockRequest.mockResolvedValue([{
      limitId: 'codex',
      limitName: 'codex',
      primary: {
        usedPercent: 9,
        resetsAt: null,
        windowDurationMins: 300
      },
      secondary: {
        usedPercent: 23,
        resetsAt: null,
        windowDurationMins: 10080
      }
    }])

    const wrapper = mountModal({
      open: true
    })

    await flushPromises()

    expect(wrapper.text()).not.toContain('Next reset')
  })

  it('renders server errors when quota loading fails', async () => {
    mockRequest.mockRejectedValue(new Error('Failed to load rate limits.'))

    const wrapper = mountModal({
      open: true
    })

    await flushPromises()

    expect(wrapper.text()).toContain('Failed to load rate limits.')
  })
})

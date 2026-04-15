/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'
import UsageStatusModal from '../app/components/UsageStatusModal.vue'

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
    props,
    global: {
      stubs: {
        UModal: ModalStub,
        UAlert: AlertStub
      }
    }
  })

describe('usage status modal', () => {
  it('renders loading and empty states compactly', () => {
    const loadingWrapper = mountModal({
      open: true,
      loading: true
    })

    expect(loadingWrapper.text()).toContain('Loading current quota windows...')

    const emptyWrapper = mountModal({
      open: true,
      loading: false,
      buckets: []
    })

    expect(emptyWrapper.text()).toContain('No live quota windows were reported.')
  })

  it('renders stacked quota windows with reset timestamps', () => {
    const wrapper = mountModal({
      open: true,
      buckets: [{
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
      }]
    })

    expect(wrapper.text()).toContain('GPT-5')
    expect(wrapper.text()).toContain('5h window')
    expect(wrapper.text()).toContain('1w window')
    expect(wrapper.text()).toContain('72% used')
    expect(wrapper.text()).toContain('45% used')
    expect(wrapper.findAll('time').map(node => node.attributes('datetime'))).toEqual([
      '2026-04-15T12:00:00.000Z',
      '2026-04-20T00:00:00.000Z'
    ])
  })

  it('renders server errors when quota loading fails', () => {
    const wrapper = mountModal({
      open: true,
      error: 'Failed to load rate limits.'
    })

    expect(wrapper.text()).toContain('Failed to load rate limits.')
  })
})

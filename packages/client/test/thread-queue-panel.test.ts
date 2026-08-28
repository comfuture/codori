// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ThreadQueuePanel from '../app/components/ThreadQueuePanel.vue'
import { buildTextThreadQueueInput } from '../shared/thread-queue'

describe('ThreadQueuePanel', () => {
  it('renders paused queue controls and emits stable reorder and start actions', async () => {
    const wrapper = mount(ThreadQueuePanel, {
      props: {
        submissions: [{
          id: 'one',
          clientUserMessageId: 'client-one',
          input: buildTextThreadQueueInput('first')
        }, {
          id: 'two',
          clientUserMessageId: 'client-two',
          input: buildTextThreadQueueInput('second')
        }],
        paused: true,
        loading: false,
        mutating: false,
        error: null
      }
    })

    expect(wrapper.text()).toContain('After current turn')
    expect(wrapper.text()).toContain('Paused')
    await wrapper.get('[aria-label="Move queued prompt 2 up"]').trigger('click')
    expect(wrapper.emitted('reorder')?.[0]).toEqual([['two', 'one']])
    await wrapper.get('[aria-label="Start queued prompt 1"]').trigger('click')
    expect(wrapper.emitted('start')?.[0]).toEqual(['one'])
  })

  it('edits text entries but keeps externally structured entries visible and read-only', async () => {
    const wrapper = mount(ThreadQueuePanel, {
      props: {
        submissions: [{
          id: 'text',
          clientUserMessageId: 'client-text',
          input: buildTextThreadQueueInput('editable')
        }, {
          id: 'image',
          clientUserMessageId: 'client-image',
          input: [{ type: 'localImage', path: '/tmp/image.png' }]
        }],
        paused: false,
        loading: false,
        mutating: false,
        error: null
      }
    })

    await wrapper.get('[aria-label="Edit queued prompt 1"]').trigger('click')
    await wrapper.get('input[aria-label="Edit queued prompt"]').setValue('updated')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.emitted('update')?.[0]).toEqual(['text', 'updated'])
    expect(wrapper.get('[aria-label="Edit queued prompt 2"]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[aria-label="Edit queued prompt 2"]').attributes('title')).toContain('Structured queued inputs')
  })
})

// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import AsyncDelivery from '../app/components/message-part/AsyncDelivery.vue'

const IconStub = defineComponent({
  name: 'UIcon',
  props: {
    name: {
      type: String,
      default: ''
    }
  },
  template: '<span data-testid="icon" :data-name="name" />'
})

const mountDelivery = (delivery: 'async' | null | undefined) => mount(AsyncDelivery, {
  props: { delivery },
  global: {
    stubs: {
      UIcon: IconStub
    }
  }
})

describe('AsyncDelivery', () => {
  it('labels asynchronous agent messages', () => {
    const wrapper = mountDelivery('async')

    expect(wrapper.get('[data-testid="async-message-delivery"]').text()).toBe('Async message')
    expect(wrapper.get('[role="note"]').attributes('aria-label')).toBe('Asynchronous message')
    expect(wrapper.get('[data-testid="icon"]').attributes('data-name')).toBe('i-lucide-message-square-reply')
  })

  it('does not label ordinary agent messages', () => {
    expect(mountDelivery(null).find('[data-testid="async-message-delivery"]').exists()).toBe(false)
  })
})

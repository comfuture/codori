// @vitest-environment jsdom
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import MessageContent from '../app/components/MessageContent.vue'
import { asAgentMessageItem, itemToMessages } from '../shared/codex-chat'

vi.mock('../app/components/MessagePartRenderer', () => ({ default: { template: '<span>Message text</span>' } }))

describe('async question transcript badge', () => {
  it('keeps a reopenable User Answer badge in history with the original structured questions', async () => {
    const message = itemToMessages(asAgentMessageItem({
      id: 'question', text: 'Which layout?', delivery: 'async',
      questions: [{ title: 'Which layout?', options: ['Compact', 'Wide'] }]
    }))[0]!
    const wrapper = mount(MessageContent, {
      props: { message, allowAsyncReply: true },
      global: { stubs: { MessagePartAsyncDelivery: true } }
    })
    expect(wrapper.get('button').text()).toBe('[User Answer]')
    expect(wrapper.get('button').attributes('aria-label')).toBe('Answer: Which layout?')
    expect(wrapper.find('form').exists()).toBe(false)
    await wrapper.get('button').trigger('click')
    expect(wrapper.emitted('answer')).toEqual([[message]])
  })
})

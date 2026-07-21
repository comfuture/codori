// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import MessagePartAttachment from '../app/components/message-part/Attachment.vue'
import type { ChatPart } from '../shared/codex-chat'

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

describe('MessagePartAttachment', () => {
  it('renders remote audio attachments with native playback controls', () => {
    const part: Extract<ChatPart, { type: 'attachment' }> = {
      type: 'attachment',
      attachment: {
        kind: 'audio',
        name: 'voice-note.mp3',
        mediaType: 'audio/mpeg',
        url: 'data:audio/mpeg;base64,abc123'
      }
    }
    const wrapper = mount(MessagePartAttachment, {
      props: { part },
      global: {
        stubs: {
          UIcon: IconStub
        }
      }
    })

    const audio = wrapper.get('audio')
    expect(audio.attributes('src')).toBe('data:audio/mpeg;base64,abc123')
    expect(audio.attributes()).toHaveProperty('controls')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.get('[data-testid="icon"]').attributes('data-name')).toBe('i-lucide-audio-lines')
  })
})

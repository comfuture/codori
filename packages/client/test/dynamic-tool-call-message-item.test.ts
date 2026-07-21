// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import DynamicToolCall from '../app/components/message-item/DynamicToolCall.vue'
import type { DynamicToolCallItem } from '../shared/codex-chat'

const ChatToolStub = defineComponent({
  name: 'UChatTool',
  template: '<section><slot /></section>'
})

const makeDynamicToolCall = (
  overrides: Partial<DynamicToolCallItem> = {}
): DynamicToolCallItem => ({
  type: 'dynamicToolCall',
  id: 'dynamic-1',
  namespace: null,
  tool: 'internal_tool',
  arguments: {},
  status: 'completed',
  contentItems: null,
  success: true,
  durationMs: 10,
  ...overrides
})

describe('DynamicToolCall', () => {
  it('labels text, image, and audio output content without conflating their fields', () => {
    const wrapper = mount(DynamicToolCall, {
      props: {
        item: makeDynamicToolCall({
          contentItems: [{
            type: 'inputText',
            text: 'Transcript'
          }, {
            type: 'inputImage',
            imageUrl: 'data:image/png;base64,image'
          }, {
            type: 'inputAudio',
            audioUrl: 'data:audio/mpeg;base64,audio'
          }]
        })
      },
      global: {
        stubs: {
          UChatTool: ChatToolStub
        }
      }
    })

    expect(wrapper.text()).toContain('Transcript')
    expect(wrapper.text()).toContain('[image] data:image/png;base64,image')
    expect(wrapper.text()).toContain('[audio] data:audio/mpeg;base64,audio')
  })
})

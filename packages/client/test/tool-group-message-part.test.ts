/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MessagePartToolGroup from '../app/components/message-part/ToolGroup.vue'
import {
  ITEM_PART,
  TOOL_GROUP_PART,
  type ChatPart
} from '../shared/codex-chat'

const UChatToolStub = defineComponent({
  name: 'UChatTool',
  props: {
    text: {
      type: String,
      default: ''
    },
    suffix: {
      type: String,
      default: ''
    },
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:open'],
  template: `
    <section data-testid="tool-group">
      <button type="button" data-testid="trigger" @click="$emit('update:open', !open)">
        <span data-testid="text">{{ text }}</span>
        <span data-testid="suffix">{{ suffix }}</span>
      </button>
      <div v-if="open" data-testid="body">
        <slot />
      </div>
    </section>
  `
})

const MessagePartItemStub = defineComponent({
  name: 'MessagePartItem',
  props: {
    part: {
      type: Object,
      required: true
    }
  },
  template: '<article data-testid="child">{{ part.data.kind }}:{{ part.data.item.id }}</article>'
})

describe('MessagePartToolGroup', () => {
  it('renders a collapsed summary and expands existing child item renderers', async () => {
    const part: Extract<ChatPart, { type: typeof TOOL_GROUP_PART }> = {
      type: TOOL_GROUP_PART,
      data: {
        id: 'tool-group:2:cmd-1:search-1',
        summary: '2 tool calls',
        details: '1 command, 1 web search',
        messages: [{
          id: 'cmd-1',
          role: 'system',
          parts: [{
            type: ITEM_PART,
            data: {
              kind: 'command_execution',
              item: {
                type: 'commandExecution',
                id: 'cmd-1',
                pluginId: null,
                scriptPath: null,
                command: 'rg grouped',
                cwd: '/tmp',
                processId: null,
                source: 'agent',
                status: 'completed',
                commandActions: [],
                aggregatedOutput: null,
                exitCode: 0,
                durationMs: 10
              }
            }
          }]
        }, {
          id: 'search-1',
          role: 'system',
          parts: [{
            type: ITEM_PART,
            data: {
              kind: 'web_search',
              item: {
                type: 'webSearch',
                id: 'search-1',
                query: 'openai codex grouping',
                action: null,
                results: null
              },
              status: 'completed'
            }
          }]
        }]
      }
    }

    const wrapper = mount(MessagePartToolGroup, {
      props: { part },
      global: {
        stubs: {
          UChatTool: UChatToolStub,
          MessagePartItem: MessagePartItemStub
        }
      }
    })

    expect(wrapper.get('[data-testid="text"]').text()).toBe('2 tool calls')
    expect(wrapper.get('[data-testid="suffix"]').text()).toBe('1 command, 1 web search')
    expect(wrapper.find('[data-testid="body"]').exists()).toBe(false)

    await wrapper.get('[data-testid="trigger"]').trigger('click')

    expect(wrapper.findAll('[data-testid="child"]').map(child => child.text())).toEqual([
      'command_execution:cmd-1',
      'web_search:search-1'
    ])
  })
})

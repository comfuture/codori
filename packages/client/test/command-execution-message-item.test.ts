// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, expect, it } from 'vitest'
import type { CommandExecutionItem } from '../shared/codex-chat'

import CommandExecution from '../app/components/message-item/CommandExecution.vue'

const ChatToolStub = defineComponent({
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
    icon: {
      type: String,
      default: ''
    }
  },
  template: `
    <section data-testid="command-tool">
      <header>
        <span data-testid="title">{{ text }}</span>
        <span data-testid="suffix">{{ suffix }}</span>
        <span data-testid="icon">{{ icon }}</span>
      </header>
      <slot />
    </section>
  `
})

const makeCommandItem = (overrides: Partial<CommandExecutionItem> = {}): CommandExecutionItem => ({
  type: 'commandExecution',
  id: 'cmd-1',
  pluginId: null,
  scriptPath: null,
  command: 'rg missing-pattern',
  cwd: '/tmp',
  processId: null,
  source: 'agent',
  status: 'completed',
  commandActions: [],
  aggregatedOutput: '',
  exitCode: 0,
  durationMs: 12,
  ...overrides
})

describe('CommandExecution', () => {
  it('shows failed commands as muted metadata instead of a large alert', () => {
    const wrapper = mount(CommandExecution, {
      props: {
        item: makeCommandItem({
          status: 'failed',
          exitCode: 1
        })
      },
      global: {
        stubs: {
          UChatTool: ChatToolStub
        }
      }
    })

    expect(wrapper.get('[data-testid="title"]').text()).toBe('Run failed')
    expect(wrapper.get('[data-testid="icon"]').text()).toBe('i-lucide-terminal')
    expect(wrapper.text()).toContain('Run failed · exit code 1')
    expect(wrapper.text()).not.toContain('Command failed with exit code 1')
    expect(wrapper.findComponent({ name: 'UAlert' }).exists()).toBe(false)
  })

  it('keeps successful exit codes neutral', () => {
    const wrapper = mount(CommandExecution, {
      props: {
        item: makeCommandItem()
      },
      global: {
        stubs: {
          UChatTool: ChatToolStub
        }
      }
    })

    expect(wrapper.text()).toContain('Exit code 0')
    expect(wrapper.text()).not.toContain('Run failed · exit code 0')
  })

  it('renders ANSI-styled output without exposing escape codes', () => {
    const wrapper = mount(CommandExecution, {
      props: {
        item: makeCommandItem({
          aggregatedOutput: 'plain \x1B[31;1mred bold\x1B[0m done'
        })
      },
      global: {
        stubs: {
          UChatTool: ChatToolStub
        }
      }
    })

    const segments = wrapper.findAll('[data-ansi-output-segment]')
    expect(wrapper.text()).toContain('plain red bold done')
    expect(wrapper.text()).not.toContain('\x1B[31;1m')
    expect(segments.map(segment => segment.element.textContent)).toEqual([
      'plain ',
      'red bold',
      ' done'
    ])
    expect(segments[1]?.attributes('style')).toContain('color: rgb(220, 38, 38)')
    expect(segments[1]?.attributes('style')).toContain('font-weight: 700')
  })
})

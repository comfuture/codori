/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, type Component } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('beautiful-mermaid', () => {
  return {
    THEMES: {
      'tokyo-night': { bg: '#1a1b26', fg: '#a9b1d6' },
      'tokyo-night-light': { bg: '#d5d6db', fg: '#343b58' }
    },
    renderMermaidSVG: (content: string) => {
      if (/^(gantt|pie title|gitGraph)/m.test(content.trim())) {
        throw new Error(`Unsupported Mermaid diagram: ${content.trim().split('\n')[0]}`)
      }

      return `<svg data-mermaid="true"><text>${content}</text></svg>`
    }
  }
})

vi.mock('@comark/vue', () => {
  return {
    Comark: defineComponent({
      name: 'MockComark',
      props: {
        markdown: {
          type: String,
          required: true
        },
        plugins: {
          type: Array,
          default: () => []
        },
        components: {
          type: Object,
          default: () => ({})
        },
        streaming: {
          type: Boolean,
          default: false
        }
      },
      setup(props) {
        const hasPlugin = (name: string) => {
          return props.plugins.some((plugin) => {
            return Boolean(plugin && typeof plugin === 'object' && 'name' in plugin && plugin.name === name)
          })
        }

        return () => {
          const text = props.markdown
          const components = props.components as Record<string, Component>
          const mermaidMatch = text.match(/^([\s\S]*?)```mermaid\n([\s\S]*?)(?:\n```([\s\S]*))?$/)

          if (mermaidMatch && hasPlugin('mermaid') && components.mermaid) {
            return h('div', { class: 'mock-comark', 'data-streaming': String(props.streaming) }, [
              mermaidMatch[1],
              h(components.mermaid, {
                content: mermaidMatch[2],
                class: ''
              }),
              mermaidMatch[3] ?? ''
            ])
          }

          const displayMatch = text.match(/^([\s\S]*?)\$\$([\s\S]*?)\$\$([\s\S]*)$/)

          if (displayMatch && hasPlugin('math') && components.math) {
            return h('div', { class: 'mock-comark', 'data-streaming': String(props.streaming) }, [
              displayMatch[1],
              h(components.math, {
                content: displayMatch[2],
                class: 'block'
              }),
              displayMatch[3]
            ])
          }

          const inlineMatch = text.match(/^(.*?)\$(.+?)\$(.*)$/)

          if (inlineMatch && hasPlugin('math') && components.math) {
            return h('div', { class: 'mock-comark', 'data-streaming': String(props.streaming) }, [
              h('p', [
                inlineMatch[1],
                h(components.math, {
                  content: inlineMatch[2],
                  class: 'inline'
                }),
                inlineMatch[3]
              ])
            ])
          }

          return h('div', { class: 'mock-comark', 'data-streaming': String(props.streaming) }, text)
        }
      }
    })
  }
})

vi.mock('@comark/vue/plugins/highlight', () => {
  return {
    default: () => ({ name: 'highlight' })
  }
})

vi.mock('@comark/vue/plugins/math', () => {
  return {
    default: () => ({ name: 'math' }),
    Math: defineComponent({
      name: 'MockComarkMath',
      props: {
        content: {
          type: String,
          required: true
        },
        class: {
          type: String,
          default: ''
        }
      },
      setup(props) {
        const isInline = props.class.includes('inline')

        return () => h(isInline ? 'span' : 'div', {
          class: isInline ? 'math inline' : 'math block',
          innerHTML: isInline
            ? `<span class="katex">${props.content}</span>`
            : `<span class="katex-display">${props.content}</span>`
        })
      }
    })
  }
})

vi.mock('@comark/vue/plugins/mermaid', () => {
  return {
    default: () => ({ name: 'mermaid' })
  }
})

import MessagePartText from '../app/components/message-part/Text.vue'

const settle = async () => {
  await flushPromises()
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await flushPromises()
}

const mountAssistantText = async (text: string, state: 'done' | 'streaming' = 'done') => {
  const wrapper = mount(MessagePartText, {
    attachTo: document.body,
    props: {
      role: 'assistant',
      part: {
        type: 'text',
        text,
        state
      }
    }
  })

  await settle()

  return wrapper
}

afterEach(() => {
  document.body.innerHTML = ''
  document.documentElement.className = ''
})

describe('message part text markdown rendering', () => {
  it('renders inline LaTeX formulas with KaTeX markup', async () => {
    const wrapper = await mountAssistantText('Energy stays concise: $E = mc^2$.')

    expect(wrapper.find('.math.inline').exists()).toBe(true)
    expect(wrapper.find('.math.inline .katex').exists()).toBe(true)
    expect(wrapper.html()).not.toContain('$E = mc^2$')
  })

  it('renders block LaTeX formulas with display math markup', async () => {
    const wrapper = await mountAssistantText(
      'Solve this first.\n\n$$x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}$$\n\nThen continue.'
    )

    expect(wrapper.find('.math.block').exists()).toBe(true)
    expect(wrapper.find('.math.block .katex-display').exists()).toBe(true)
    expect(wrapper.text()).toContain('Solve this first.')
    expect(wrapper.text()).toContain('Then continue.')
  })

  it('renders Mermaid code fences as diagrams while streaming', async () => {
    const wrapper = await mountAssistantText([
      'Diagram:',
      '',
      '```mermaid',
      'graph TD',
      '  A[Start] --> B[End]',
      '',
      'Looks good so far.'
    ].join('\n'), 'streaming')

    await wrapper.setProps({
      part: {
        type: 'text',
        text: [
          'Diagram:',
          '',
          '```mermaid',
          'graph TD',
          '  A[Start] --> B[End]',
          '```',
          '',
          'Looks good so far.'
        ].join('\n'),
        state: 'streaming'
      }
    })
    await settle()

    expect(wrapper.find('.mermaid').exists()).toBe(true)
    expect(wrapper.find('.mermaid svg').exists()).toBe(true)
    expect(wrapper.text()).toContain('Diagram:')
    expect(wrapper.text()).toContain('Looks good so far.')
    expect(wrapper.html()).not.toContain('<code class="language-mermaid">')
  })

  it('falls back unsupported Mermaid blocks to plain code blocks', async () => {
    const wrapper = await mountAssistantText([
      '```mermaid',
      'gantt',
      '  title Unsupported here',
      '```'
    ].join('\n'))

    expect(wrapper.find('.cd-markdown-mermaid-fallback').exists()).toBe(true)
    expect(wrapper.find('pre code.language-mermaid').exists()).toBe(true)
    expect(wrapper.find('.mermaid svg').exists()).toBe(false)
  })
})

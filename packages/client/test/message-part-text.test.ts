/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, type Component } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
          const mermaidMatch = text.match(/^```mermaid\n([\s\S]*?)(?:\n```)?$/)

          if (mermaidMatch && hasPlugin('mermaid') && components.mermaid) {
            return h('div', { class: 'mock-comark', 'data-streaming': String(props.streaming) }, [
              h(components.mermaid, {
                content: mermaidMatch[1],
                class: ''
              })
            ])
          }

          const displayMatch = text.match(/^\$\$([\s\S]*?)\$\$$/)

          if (displayMatch && hasPlugin('math') && components.math) {
            return h('div', { class: 'mock-comark', 'data-streaming': String(props.streaming) }, [
              h(components.math, {
                content: displayMatch[1],
                class: 'block'
              })
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
    default: () => ({ name: 'mermaid' }),
    Mermaid: defineComponent({
      name: 'MockComarkMermaid',
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
        return () => h('div', {
          class: `mermaid ${props.class}`.trim(),
          innerHTML: `<svg data-mermaid="true"><text>${props.content}</text></svg>`
        })
      }
    })
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
    const wrapper = await mountAssistantText('$$x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}$$')

    expect(wrapper.find('.math.block').exists()).toBe(true)
    expect(wrapper.find('.math.block .katex-display').exists()).toBe(true)
    expect(wrapper.html()).not.toContain('$$x =')
  })

  it('renders Mermaid code fences as diagrams while streaming', async () => {
    const wrapper = await mountAssistantText([
      '```mermaid',
      'graph TD',
      '  A[Start] --> B[End]'
    ].join('\n'), 'streaming')

    await wrapper.setProps({
      part: {
        type: 'text',
        text: [
          '```mermaid',
          'graph TD',
          '  A[Start] --> B[End]',
          '```'
        ].join('\n'),
        state: 'streaming'
      }
    })
    await settle()

    expect(wrapper.find('.mermaid').exists()).toBe(true)
    expect(wrapper.find('.mermaid svg').exists()).toBe(true)
    expect(wrapper.html()).not.toContain('<code class="language-mermaid">')
  })
})

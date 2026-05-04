/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, type Component } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const openViewerMock = vi.fn()

vi.mock('../app/composables/useProjects', () => {
  return {
    useProjects: () => ({
      getProject: (projectId?: string | null) => projectId
        ? { projectPath: '/Users/comfuture/Project/codori' }
        : null
    })
  }
})

vi.mock('../app/composables/useLocalFileViewer', () => {
  return {
    useLocalFileViewer: () => ({
      openViewer: openViewerMock
    })
  }
})

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

        type MockComarkNode = string | [string, Record<string, unknown>, ...MockComarkNode[]]

        const renderMockNode = (node: MockComarkNode): ReturnType<typeof h> | string => {
          if (typeof node === 'string') {
            return node
          }

          const [tag, nodeProps, ...children] = node
          const components = props.components as Record<string, Component>
          const component = components[tag] ?? tag
          const renderedChildren = children.map(renderMockNode)
          return typeof component === 'string'
            ? h(component, nodeProps, renderedChildren)
            : h(component, nodeProps, () => renderedChildren)
        }

        const renderSkillLinkTree = (text: string) => {
          const skillLinkPattern = /\[\$([a-z0-9][a-z0-9:._/-]*)\]\(([^)]+\/SKILL\.md)\)/giu
          const nodes: MockComarkNode[] = []
          let lastIndex = 0
          let match: RegExpExecArray | null

          while ((match = skillLinkPattern.exec(text)) !== null) {
            if (match.index > lastIndex) {
              nodes.push(text.slice(lastIndex, match.index))
            }

            nodes.push(['a', { href: match[2] }, `$${match[1]}`])
            lastIndex = match.index + match[0].length
          }

          if (lastIndex === 0) {
            return null
          }

          if (lastIndex < text.length) {
            nodes.push(text.slice(lastIndex))
          }

          const state = {
            markdown: text,
            tree: {
              nodes: [['p', {}, ...nodes] as MockComarkNode],
              frontmatter: {},
              meta: {}
            },
            options: { plugins: props.plugins },
            tokens: []
          }

          for (const plugin of props.plugins) {
            if (
              plugin
              && typeof plugin === 'object'
              && 'post' in plugin
              && typeof plugin.post === 'function'
            ) {
              plugin.post(state)
            }
          }

          return h('div', { class: 'mock-comark', 'data-streaming': String(props.streaming) }, [
            ...state.tree.nodes.map(renderMockNode)
          ])
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

          const skillLinkTree = renderSkillLinkTree(text)
          if (skillLinkTree) {
            return skillLinkTree
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

          const linkMatch = text.match(/^\[(.+?)\]\((.+?)\)$/)
          if (linkMatch && components.a) {
            return h('div', { class: 'mock-comark', 'data-streaming': String(props.streaming) }, [
              h(components.a, {
                href: linkMatch[2],
                title: ''
              }, {
                default: () => [linkMatch[1]]
              })
            ])
          }

          return h('div', { class: 'mock-comark', 'data-streaming': String(props.streaming) }, text)
        }
      }
    })
  }
})

vi.mock('../app/components/message-part/SkillReferenceBadge.vue', () => {
  return {
    default: defineComponent({
      name: 'SkillReferenceBadge',
      props: {
        name: {
          type: String,
          required: true
        },
        path: {
          type: String,
          default: null
        }
      },
      setup(props) {
        return () => h('span', {
          'data-test': 'skill-reference-badge',
          'data-skill-name': props.name,
          'data-skill-path': props.path ?? ''
        }, `$${props.name}`)
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

const mountText = async (
  role: 'user' | 'assistant' | 'system',
  text: string,
  state: 'done' | 'streaming' = 'done'
) => {
  const wrapper = mount(MessagePartText, {
    attachTo: document.body,
    props: {
      role,
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
  openViewerMock.mockReset()
})

describe('message part text markdown rendering', () => {
  it('renders inline LaTeX formulas with KaTeX markup', async () => {
    const wrapper = await mountText('assistant', 'Energy stays concise: $E = mc^2$.')

    expect(wrapper.find('.math.inline').exists()).toBe(true)
    expect(wrapper.find('.math.inline .katex').exists()).toBe(true)
    expect(wrapper.html()).not.toContain('$E = mc^2$')
  })

  it('renders block LaTeX formulas with display math markup', async () => {
    const wrapper = await mountText(
      'assistant',
      'Solve this first.\n\n$$x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}$$\n\nThen continue.'
    )

    expect(wrapper.find('.math.block').exists()).toBe(true)
    expect(wrapper.find('.math.block .katex-display').exists()).toBe(true)
    expect(wrapper.text()).toContain('Solve this first.')
    expect(wrapper.text()).toContain('Then continue.')
  })

  it('renders Mermaid code fences as diagrams while streaming', async () => {
    const wrapper = await mountText('assistant', [
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
    const wrapper = await mountText('assistant', [
      '```mermaid',
      'gantt',
      '  title Unsupported here',
      '```'
    ].join('\n'))

    expect(wrapper.find('.cd-markdown-mermaid-fallback').exists()).toBe(true)
    expect(wrapper.find('pre code.language-mermaid').exists()).toBe(true)
    expect(wrapper.find('.mermaid svg').exists()).toBe(false)
  })

  it('routes project-local absolute file links to the in-app viewer', async () => {
    const wrapper = mount(MessagePartText, {
      attachTo: document.body,
      props: {
        role: 'assistant',
        projectId: 'demo',
        part: {
          type: 'text',
          text: '[ChatWorkspace.vue](/Users/comfuture/Project/codori/packages/client/app/components/ChatWorkspace.vue:12)',
          state: 'done'
        }
      }
    })

    await settle()
    await wrapper.get('a').trigger('click')

    expect(openViewerMock).toHaveBeenCalledWith({
      projectId: 'demo',
      path: '/Users/comfuture/Project/codori/packages/client/app/components/ChatWorkspace.vue',
      line: 12,
      column: null
    })
  })

  it('routes chat-local absolute file links to the in-app viewer', async () => {
    const wrapper = mount(MessagePartText, {
      attachTo: document.body,
      props: {
        role: 'assistant',
        workspace: { kind: 'chat', id: 'chat-demo' },
        workspaceRootPath: '/Users/comfuture/Documents/Chats/chat-demo',
        part: {
          type: 'text',
          text: '[notes.md](/Users/comfuture/Documents/Chats/chat-demo/notes.md:3)',
          state: 'done'
        }
      }
    })

    await settle()
    await wrapper.get('a').trigger('click')

    expect(openViewerMock).toHaveBeenCalledWith({
      workspace: { kind: 'chat', id: 'chat-demo' },
      path: '/Users/comfuture/Documents/Chats/chat-demo/notes.md',
      line: 3,
      column: null
    })
  })

  it('renders markdown links in user messages and routes local files to the viewer', async () => {
    const wrapper = mount(MessagePartText, {
      attachTo: document.body,
      props: {
        role: 'user',
        projectId: 'demo',
        part: {
          type: 'text',
          text: '[LocalFileViewerModal.vue](/Users/comfuture/Project/codori/packages/client/app/components/LocalFileViewerModal.vue)',
          state: 'done'
        }
      }
    })

    await settle()
    await wrapper.get('a').trigger('click')

    expect(openViewerMock).toHaveBeenCalledWith({
      projectId: 'demo',
      path: '/Users/comfuture/Project/codori/packages/client/app/components/LocalFileViewerModal.vue',
      line: null,
      column: null
    })
  })

  it('renders submitted skill markdown links as skill reference badges through Comark', async () => {
    const wrapper = await mountText(
      'assistant',
      'Use [$imagegen](/Users/demo/.codex/skills/.system/imagegen/SKILL.md) now.'
    )

    const badge = wrapper.get('[data-test="skill-reference-badge"]')
    expect(badge.text()).toBe('$imagegen')
    expect(badge.attributes('data-skill-name')).toBe('imagegen')
    expect(badge.attributes('data-skill-path')).toBe('/Users/demo/.codex/skills/.system/imagegen/SKILL.md')
    expect(wrapper.find('a[href="/Users/demo/.codex/skills/.system/imagegen/SKILL.md"]').exists()).toBe(false)
  })

  it('keeps ordinary markdown links as anchors when the skill badge plugin does not match', async () => {
    const wrapper = await mountText('assistant', '[docs](https://example.com/docs)')

    expect(wrapper.find('[data-test="skill-reference-badge"]').exists()).toBe(false)
    expect(wrapper.get('a').attributes('href')).toBe('https://example.com/docs')
    expect(wrapper.get('a').text()).toBe('docs')
  })

  it('renders multiple skill references without collapsing surrounding text', async () => {
    const wrapper = await mountText(
      'assistant',
      'Use [$imagegen](/a/imagegen/SKILL.md) and [$browser-use](/b/browser-use/SKILL.md).'
    )

    const badges = wrapper.findAll('[data-test="skill-reference-badge"]')
    expect(badges).toHaveLength(2)
    expect(badges.map(badge => badge.text())).toEqual(['$imagegen', '$browser-use'])
    expect(wrapper.text()).toContain('Use $imagegen and $browser-use.')
  })
})

// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.fn()

vi.mock('../app/composables/useProjects', () => {
  return {
    useProjects: () => ({
      getProject: (projectId?: string | null) => projectId
        ? { projectPath: '/Users/demo/Project/codori' }
        : null
    })
  }
})

vi.mock('../app/composables/useRpc', () => {
  return {
    useRpc: () => ({
      getWorkspaceClient: () => ({
        request: requestMock
      })
    })
  }
})

import SkillReferenceBadge from '../app/components/message-part/SkillReferenceBadge.vue'

const BadgeStub = defineComponent({
  name: 'UBadge',
  props: {
    as: {
      type: String,
      default: 'span'
    },
    color: {
      type: String,
      default: undefined
    },
    variant: {
      type: String,
      default: undefined
    },
    size: {
      type: String,
      default: undefined
    },
    ui: {
      type: Object,
      default: () => ({})
    },
    title: {
      type: String,
      default: undefined
    }
  },
  setup(props, { slots }) {
    return () => h(props.as, {
      class: 'badge-stub',
      title: props.title,
      'data-color': props.color,
      'data-variant': props.variant,
      'data-size': props.size,
      'data-base': props.ui?.base ?? ''
    }, slots.default?.())
  }
})

describe('SkillReferenceBadge', () => {
  beforeEach(() => {
    requestMock.mockReset()
  })

  it('renders metadata display names when the skill catalog resolves', async () => {
    requestMock.mockResolvedValue({
      data: [{
        cwd: '/Users/demo/Project/codori',
        errors: [],
        skills: [{
          name: 'imagegen',
          description: 'Generate images',
          enabled: true,
          path: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md',
          scope: 'system',
          interface: {
            displayName: 'Image Generator'
          }
        }]
      }]
    })

    const wrapper = mount(SkillReferenceBadge, {
      props: {
        name: 'imagegen',
        path: '/Users/demo/.codex/skills/.system/imagegen/SKILL.md',
        workspace: { kind: 'project', id: 'demo' },
        workspaceRootPath: '/Users/demo/Project/codori'
      },
      global: {
        stubs: {
          UBadge: BadgeStub
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toBe('Image Generator')
    expect(wrapper.get('.badge-stub').attributes('data-color')).toBe('primary')
    expect(wrapper.get('.badge-stub').attributes('data-variant')).toBe('soft')
    expect(wrapper.get('.badge-stub').attributes('data-base')).toContain('bg-[#7c3aed]/15')
    expect(wrapper.get('.badge-stub').attributes('title')).toBe('/Users/demo/.codex/skills/.system/imagegen/SKILL.md')
  })

  it('falls back to a skill marker and token name when metadata is unavailable', async () => {
    requestMock.mockResolvedValue({
      data: [{
        cwd: '/Users/demo/Project/codori',
        errors: [],
        skills: []
      }]
    })

    const wrapper = mount(SkillReferenceBadge, {
      props: {
        name: '$missing-skill',
        workspace: { kind: 'project', id: 'demo' },
        workspaceRootPath: '/Users/demo/Project/codori'
      },
      global: {
        stubs: {
          UBadge: BadgeStub
        }
      }
    })

    await flushPromises()

    expect(wrapper.text()).toBe('🛠️missing-skill')
  })
})

// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const requestMock = vi.fn()

const createDeferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return {
    promise,
    resolve,
    reject
  }
}

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

  it('retries catalog fetches after transient failures', async () => {
    requestMock
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        data: [{
          cwd: '/Users/demo/Project/retry',
          errors: [],
          skills: [{
            name: 'retry-skill',
            description: 'Retry skill',
            enabled: true,
            path: '/Users/demo/.codex/skills/retry-skill/SKILL.md',
            scope: 'user',
            interface: {
              displayName: 'Retry Skill'
            }
          }]
        }]
      })

    const firstWrapper = mount(SkillReferenceBadge, {
      props: {
        name: 'retry-skill',
        workspace: { kind: 'project', id: 'retry' },
        workspaceRootPath: '/Users/demo/Project/retry'
      },
      global: {
        stubs: {
          UBadge: BadgeStub
        }
      }
    })

    await flushPromises()
    expect(firstWrapper.text()).toBe('🛠️retry-skill')
    firstWrapper.unmount()

    const secondWrapper = mount(SkillReferenceBadge, {
      props: {
        name: 'retry-skill',
        workspace: { kind: 'project', id: 'retry' },
        workspaceRootPath: '/Users/demo/Project/retry'
      },
      global: {
        stubs: {
          UBadge: BadgeStub
        }
      }
    })

    await flushPromises()

    expect(requestMock).toHaveBeenCalledTimes(2)
    expect(secondWrapper.text()).toBe('Retry Skill')
  })

  it('ignores stale catalog responses after workspace changes', async () => {
    const firstRequest = createDeferred<unknown>()
    const secondRequest = createDeferred<unknown>()
    requestMock
      .mockReturnValueOnce(firstRequest.promise)
      .mockReturnValueOnce(secondRequest.promise)

    const wrapper = mount(SkillReferenceBadge, {
      props: {
        name: 'race-skill',
        workspace: { kind: 'project', id: 'race' },
        workspaceRootPath: '/Users/demo/Project/race-a'
      },
      global: {
        stubs: {
          UBadge: BadgeStub
        }
      }
    })

    await wrapper.setProps({
      workspaceRootPath: '/Users/demo/Project/race-b'
    })

    secondRequest.resolve({
      data: [{
        cwd: '/Users/demo/Project/race-b',
        errors: [],
        skills: [{
          name: 'race-skill',
          description: 'Fresh skill',
          enabled: true,
          path: '/Users/demo/.codex/skills/race-skill/SKILL.md',
          scope: 'user',
          interface: {
            displayName: 'Fresh Skill'
          }
        }]
      }]
    })
    await flushPromises()
    expect(wrapper.text()).toBe('Fresh Skill')

    firstRequest.resolve({
      data: [{
        cwd: '/Users/demo/Project/race-a',
        errors: [],
        skills: [{
          name: 'race-skill',
          description: 'Stale skill',
          enabled: true,
          path: '/Users/demo/.codex/skills/race-skill/SKILL.md',
          scope: 'user',
          interface: {
            displayName: 'Stale Skill'
          }
        }]
      }]
    })
    await flushPromises()

    expect(wrapper.text()).toBe('Fresh Skill')
  })
})

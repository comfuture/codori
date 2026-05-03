/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { defineComponent, h, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSidebar from '../app/components/ProjectSidebar.vue'

const mockRoute = {
  params: {}
}
const mockRouterPush = vi.fn()
const mockRefreshProjects = vi.fn()
const mockRefreshChats = vi.fn()
const mockProjects = ref([])
const mockChats = ref([])

vi.mock('../app/composables/useCodoriRoute', () => ({
  useCodoriRoute: () => mockRoute
}))

vi.mock('../app/composables/useCodoriRouter', () => ({
  useCodoriRouter: () => ({
    push: mockRouterPush
  })
}))

vi.mock('../app/composables/useProjects', () => ({
  useProjects: () => ({
    projects: mockProjects,
    loaded: ref(true),
    loading: ref(false),
    refreshProjects: mockRefreshProjects
  })
}))

vi.mock('../app/composables/useChats', () => ({
  useChats: () => ({
    chats: mockChats,
    loaded: ref(true),
    loading: ref(false),
    createPending: ref(false),
    deletePendingId: ref(null),
    refreshChats: mockRefreshChats,
    deleteChat: vi.fn()
  })
}))

const ButtonStub = defineComponent({
  name: 'ButtonStub',
  props: {
    label: {
      type: String,
      default: ''
    },
    ariaLabel: {
      type: String,
      default: ''
    }
  },
  emits: ['click'],
  setup(props, { attrs, emit, slots }) {
    const ariaLabel = () =>
      String(attrs['aria-label'] ?? props.ariaLabel ?? props.label ?? '')

    return () => h('button', {
      type: 'button',
      'aria-label': ariaLabel(),
      onClick: (event: MouseEvent) => emit('click', event)
    }, [
      slots.default?.() ?? props.label,
      slots.trailing?.()
    ])
  }
})

const TooltipStub = defineComponent({
  name: 'TooltipStub',
  setup(_, { slots }) {
    return () => h('div', { class: 'tooltip-stub' }, slots.default?.())
  }
})

const KbdStub = defineComponent({
  name: 'KbdStub',
  props: {
    value: {
      type: String,
      default: ''
    }
  },
  setup(props) {
    return () => h('kbd', { class: 'kbd-stub' }, props.value)
  }
})

const mountSidebar = (props: Record<string, unknown> = {}) =>
  mount(ProjectSidebar, {
    props,
    global: {
      stubs: {
        UTooltip: TooltipStub,
        UButton: ButtonStub,
        UKbd: KbdStub,
        UNavigationMenu: defineComponent({
          name: 'NavigationMenuStub',
          setup() {
            return () => h('nav')
          }
        }),
        AddProjectModal: defineComponent({
          name: 'AddProjectModalStub',
          setup() {
            return () => null
          }
        }),
        ProjectStatusDot: defineComponent({
          name: 'ProjectStatusDotStub',
          setup() {
            return () => h('span')
          }
        })
      }
    }
  })

describe('project sidebar command palette trigger', () => {
  beforeEach(() => {
    mockRouterPush.mockReset()
    mockRefreshProjects.mockReset()
    mockRefreshChats.mockReset()
    mockProjects.value = []
    mockChats.value = []
  })

  it('renders an input-like expanded search trigger before project action buttons', async () => {
    const wrapper = mountSidebar({
      collapsed: false
    })

    expect(wrapper.text()).toContain('Search')
    expect(wrapper.text()).toContain('meta')
    expect(wrapper.text()).toContain('K')

    const actionLabels = wrapper.findAll('button').map(button => button.attributes('aria-label') ?? button.text())
    expect(actionLabels.indexOf('Search Codori')).toBeLessThan(actionLabels.indexOf('Add project'))
    expect(actionLabels.indexOf('Add project')).toBeLessThan(actionLabels.indexOf('Refresh projects'))

    await wrapper.get('button[aria-label="Search Codori"]').trigger('click')

    expect(wrapper.emitted('openCommandPalette')).toHaveLength(1)
  })

  it('renders a compact search trigger when collapsed', async () => {
    const wrapper = mountSidebar({
      collapsed: true
    })

    expect(wrapper.text()).not.toContain('Search')

    await wrapper.get('button[aria-label="Search Codori"]').trigger('click')

    expect(wrapper.emitted('openCommandPalette')).toHaveLength(1)
  })
})

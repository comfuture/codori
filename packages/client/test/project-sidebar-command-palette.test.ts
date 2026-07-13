/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, reactive, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProjectSidebar from '../app/components/ProjectSidebar.vue'
import {
  resolveProjectThreadSummaryKey,
  useThreadSummaries
} from '../app/composables/useThreadSummaries'
import type { ChatSessionRecord, ProjectRecord } from '../shared/codori'
import type { ThreadListResponse } from '../shared/generated/codex-app-server/v2/ThreadListResponse'

const mockRoute = reactive({
  params: {} as Record<string, unknown>
})
const mockRouterPush = vi.fn()
const mockRefreshProjects = vi.fn()
const mockRefreshChats = vi.fn()
const mockStartProject = vi.fn()
const mockGetClient = vi.fn()
const mockRpcRequest = vi.fn()
const mockProjects = ref<ProjectRecord[]>([])
const mockChats = ref<ChatSessionRecord[]>([])
const mockProjectsLoaded = ref(true)
const mockProjectsLoading = ref(false)

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
    loaded: mockProjectsLoaded,
    loading: mockProjectsLoading,
    refreshProjects: mockRefreshProjects,
    startProject: mockStartProject,
    getProject: (projectId: string | null) =>
      mockProjects.value.find(project => project.projectId === projectId) ?? null
  })
}))

vi.mock('../app/composables/useRpc', () => ({
  useRpc: () => ({
    getClient: mockGetClient
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
      'data-icon': String(attrs.icon ?? ''),
      'data-color': String(attrs.color ?? ''),
      'data-variant': String(attrs.variant ?? ''),
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

const NavigationMenuStub = defineComponent({
  name: 'NavigationMenuStub',
  props: {
    items: {
      type: Array,
      default: () => []
    },
    modelValue: {
      type: [Array, String],
      default: undefined
    }
  },
  setup(props, { slots }) {
    const flattenNavigationItems = (
      items: unknown[],
      depth = 0
    ): Array<{ item: Record<string, unknown>, depth: number }> =>
      items
        .flatMap((entry) => {
          const groupItems = Array.isArray(entry) ? entry : [entry]
          return groupItems.flatMap((item) => {
            if (!item || typeof item !== 'object') {
              return []
            }
            const navigationItem = item as Record<string, unknown>
            const children = Array.isArray(navigationItem.children)
              ? flattenNavigationItems(navigationItem.children, depth + 1)
              : []
            return [{
              item: navigationItem,
              depth
            }, ...children]
          })
        })

    return () => h('nav', {
      class: 'navigation-menu-stub',
      'data-model-value': JSON.stringify(props.modelValue)
    }, flattenNavigationItems(props.items as unknown[]).map(({ item, depth }) => {
      const children = [
        h('span', { class: 'navigation-menu-icon' }, String(item.icon ?? '')),
        slots['item-label']?.({ item }) ?? h('span', String(item.label ?? '')),
        slots['item-trailing']?.({ item })
      ]
      const baseAttrs = {
        class: [
          'navigation-menu-item',
          item.itemKind ? `navigation-menu-item-${String(item.itemKind)}` : '',
          item.class
        ],
        'data-kind': String(item.itemKind ?? ''),
        'data-label': String(item.label ?? ''),
        'data-to': String(item.to ?? ''),
        'data-value': String(item.value ?? ''),
        'data-depth': String(depth),
        'data-active': item.active ? 'true' : 'false',
        onClick: (event: MouseEvent) => {
          const onClick = item.onClick
          if (typeof onClick === 'function') {
            onClick(event)
          }
          const onSelect = item.onSelect
          if (typeof onSelect === 'function') {
            event.preventDefault()
            onSelect(event)
          }
        }
      }

      return item.to
        ? h('a', {
            ...baseAttrs,
            href: String(item.to)
          }, children)
        : h('button', {
            ...baseAttrs,
            type: 'button',
            disabled: Boolean(item.disabled)
          }, children)
    }))
  }
})

const makeProject = (input: Partial<ProjectRecord> & Pick<ProjectRecord, 'projectId' | 'projectPath'>): ProjectRecord => ({
  status: 'running',
  pid: 101,
  port: 46000,
  startedAt: 1,
  lastActivityAt: 1,
  activeSessionCount: 0,
  idleTimeoutMs: null,
  idleDeadlineAt: null,
  error: null,
  ...input
})

const makeThread = (index: number) => ({
  id: `thread-${index}`,
  name: `Thread ${index}`,
  preview: null,
  updatedAt: 1_000 - index
})

const makeChat = (input: Partial<ChatSessionRecord> & Pick<ChatSessionRecord, 'chatId'>): ChatSessionRecord => {
  const { chatId, ...rest } = input
  return {
    chatId,
    chatPath: `/chats/${chatId}`,
    threadId: null,
    title: null,
    createdAt: 1,
    updatedAt: null,
    status: 'running',
    pid: 101,
    port: 46000,
    startedAt: 1,
    lastActivityAt: 1,
    activeSessionCount: 0,
    idleTimeoutMs: null,
    idleDeadlineAt: null,
    error: null,
    ...rest
  }
}

const makeThreadListResponse = (
  count: number,
  nextCursor: string | null = null,
  startIndex = 1
) => ({
  data: Array.from({ length: count }, (_, index) => makeThread(startIndex + index)),
  nextCursor,
  backwardsCursor: null
}) as unknown as ThreadListResponse

const waitForSidebar = async () => {
  await flushPromises()
  await nextTick()
}

const createDeferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return {
    promise,
    resolve
  }
}

const resetThreadSummaries = () => {
  for (const projectId of ['codori', 'other']) {
    const summaries = useThreadSummaries(resolveProjectThreadSummaryKey(projectId))
    summaries.setThreads([])
    summaries.setLoading(false)
    summaries.setError(null)
  }
}

const mountedWrappers: Array<{ unmount: () => void }> = []

const mountSidebar = (props: Record<string, unknown> = {}) => {
  const wrapper = mount(ProjectSidebar, {
    props,
    global: {
      stubs: {
        UTooltip: TooltipStub,
        UButton: ButtonStub,
        UKbd: KbdStub,
        UNavigationMenu: NavigationMenuStub,
        AddProjectModal: defineComponent({
          name: 'AddProjectModalStub',
          setup() {
            return () => null
          }
        }),
        ProjectStatusDot: defineComponent({
          name: 'ProjectStatusDotStub',
          setup() {
            return () => h('span', { class: 'status-dot-stub' })
          }
        })
      }
    }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

afterEach(() => {
  for (const wrapper of mountedWrappers.splice(0)) {
    wrapper.unmount()
  }
})

describe('project sidebar command palette trigger', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockRoute.params = {}
    resetThreadSummaries()
    mockRouterPush.mockReset()
    mockRefreshProjects.mockReset()
    mockRefreshChats.mockReset()
    mockStartProject.mockReset()
    mockGetClient.mockReset()
    mockRpcRequest.mockReset()
    mockProjects.value = []
    mockChats.value = []
    mockProjectsLoaded.value = true
    mockProjectsLoading.value = false
    mockGetClient.mockReturnValue({
      request: mockRpcRequest
    })
    mockRpcRequest.mockResolvedValue(makeThreadListResponse(0))
    platformSpy = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('renders search first and keeps add project in the projects section', async () => {
    const wrapper = mountSidebar({
      collapsed: false
    })

    expect(wrapper.text()).toContain('Search')
    expect(wrapper.text()).toContain('meta')
    expect(wrapper.text()).toContain('K')

    const actionLabels = wrapper.findAll('button').map(button => button.attributes('aria-label') ?? button.text())
    expect(actionLabels.indexOf('Search Codori')).toBeLessThan(actionLabels.indexOf('New Chat'))
    expect(actionLabels.indexOf('New Chat')).toBeLessThan(actionLabels.indexOf('Add project'))
    expect(actionLabels).not.toContain('Refresh projects')

    const addProject = wrapper.get('button[aria-label="Add project"]')
    expect(addProject.attributes('data-icon')).toBe('i-lucide-folder-plus')
    expect(addProject.attributes('data-color')).toBe('primary')
    expect(addProject.attributes('data-variant')).toBe('soft')

    await wrapper.get('button[aria-label="Search Codori"]').trigger('click')

    expect(wrapper.emitted('openCommandPalette')).toHaveLength(1)
  })

  it('renders the non-macOS shortcut modifier in the expanded search trigger', async () => {
    platformSpy.mockReturnValue('Linux x86_64')
    const wrapper = mountSidebar({
      collapsed: false
    })

    expect(wrapper.text()).toContain('ctrl')
    expect(wrapper.text()).toContain('K')
  })

  it('renders a compact search trigger when collapsed', async () => {
    const wrapper = mountSidebar({
      collapsed: true
    })

    expect(wrapper.text()).not.toContain('Search')
    expect(wrapper.text()).toContain('⌘')
    expect(wrapper.text()).toContain('K')

    await wrapper.get('button[aria-label="Search Codori"]').trigger('click')

    expect(wrapper.emitted('openCommandPalette')).toHaveLength(1)
  })

  it('emphasizes the active chat row', async () => {
    mockRoute.params = {
      chatId: 'chat-a'
    }
    mockChats.value = [
      makeChat({
        chatId: 'chat-a',
        title: 'Chat A'
      }),
      makeChat({
        chatId: 'chat-b',
        title: 'Chat B'
      })
    ]

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()

    const chatRoot = wrapper.get('[data-kind="chat-root"]')
    const activeChat = wrapper.get('[data-to="/chats/chat-a"]')
    const inactiveChat = wrapper.get('[data-to="/chats/chat-b"]')
    expect(chatRoot.attributes('data-depth')).toBe('0')
    expect(chatRoot.attributes('data-value')).toBe('chat-root')
    expect(chatRoot.text()).toContain('Projectless Chats')
    expect(chatRoot.text()).toContain('2')
    expect(activeChat.attributes('data-depth')).toBe('1')
    expect(activeChat.attributes('data-active')).toBe('true')
    expect(activeChat.classes()).toContain('before:bg-primary/5')
    expect(activeChat.classes()).not.toContain('ring-1')
    expect(activeChat.classes()).not.toContain('shadow-sm')
    expect(inactiveChat.attributes('data-depth')).toBe('1')
    expect(inactiveChat.attributes('data-active')).toBe('false')
    expect(inactiveChat.classes()).not.toContain('before:bg-primary/5')
    expect(wrapper.get('.navigation-menu-stub').attributes('data-model-value')).toBe('["chat-root"]')
  })

  it('opens the projectless chat group after an in-app route transition', async () => {
    mockChats.value = [makeChat({
      chatId: 'chat-a',
      title: 'Chat A'
    })]

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()
    expect(wrapper.get('.navigation-menu-stub').attributes('data-model-value')).toBe('[]')

    mockRoute.params = {
      chatId: 'chat-a'
    }
    await waitForSidebar()

    expect(wrapper.get('.navigation-menu-stub').attributes('data-model-value')).toBe('["chat-root"]')
  })
})

describe('project sidebar inline threads', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    mockRoute.params = {
      projectId: 'codori'
    }
    resetThreadSummaries()
    mockRouterPush.mockReset()
    mockRefreshProjects.mockReset()
    mockRefreshChats.mockReset()
    mockStartProject.mockReset()
    mockGetClient.mockReset()
    mockRpcRequest.mockReset()
    mockProjects.value = [
      makeProject({
        projectId: 'codori',
        projectPath: '/repo/codori'
      }),
      makeProject({
        projectId: 'other',
        projectPath: '/repo/other'
      })
    ]
    mockChats.value = []
    mockProjectsLoaded.value = true
    mockProjectsLoading.value = false
    mockGetClient.mockReturnValue({
      request: mockRpcRequest
    })
    platformSpy = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
  })

  afterEach(() => {
    platformSpy.mockRestore()
  })

  it('renders selected project threads inline without project status dots', async () => {
    mockRpcRequest.mockResolvedValue(makeThreadListResponse(2))

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()

    expect(wrapper.find('.status-dot-stub').exists()).toBe(false)
    expect(wrapper.text()).toContain('codori')
    expect(wrapper.text()).toContain('other')
    expect(wrapper.text()).toContain('Thread 1')
    expect(wrapper.text()).toContain('Thread 2')

    const threadLink = wrapper.get('[data-kind="thread"][data-to="/projects/codori/threads/thread-1"]')
    expect(threadLink.text()).toContain('Thread 1')
    expect(threadLink.attributes('data-depth')).toBe('1')
    expect(wrapper.find('[data-kind="thread"][data-to="/projects/other/threads/thread-1"]').exists()).toBe(false)

    const activeProject = wrapper.get('[data-kind="project"][data-to="/projects/codori"]')
    const inactiveProject = wrapper.get('[data-kind="project"][data-to="/projects/other"]')
    expect(activeProject.attributes('data-depth')).toBe('0')
    expect(activeProject.attributes('data-value')).toBe('project:codori')
    expect(activeProject.attributes('data-active')).toBe('true')
    expect(activeProject.classes()).toContain('before:bg-primary/5')
    expect(activeProject.classes()).not.toContain('ring-1')
    expect(activeProject.classes()).not.toContain('shadow-sm')
    expect(inactiveProject.attributes('data-depth')).toBe('0')
    expect(inactiveProject.attributes('data-active')).toBe('false')
    expect(inactiveProject.classes()).not.toContain('before:bg-primary/5')
    expect(wrapper.get('.navigation-menu-stub').attributes('data-model-value')).toBe('["project:codori"]')
    expect(mockGetClient).toHaveBeenCalledTimes(1)
    expect(mockGetClient).toHaveBeenCalledWith('codori')
    expect(mockRpcRequest).toHaveBeenCalledWith('thread/list', {
      limit: 5,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      cwd: '/repo/codori'
    })
  })

  it('appends cursor pages from an icon-free muted Show more row', async () => {
    mockRpcRequest
      .mockResolvedValueOnce(makeThreadListResponse(5, 'next-page'))
      .mockResolvedValueOnce(makeThreadListResponse(3, null, 5))

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()

    expect(wrapper.text()).toContain('Thread 1')
    expect(wrapper.text()).toContain('Thread 5')
    expect(wrapper.text()).toContain('Show more')
    expect(wrapper.text()).not.toContain('more..')
    expect(wrapper.findAll('[data-kind="thread"]')).toHaveLength(5)

    const showMore = wrapper.get('[data-kind="more"]')
    expect(showMore.attributes('data-label')).toBe('Show more')
    expect(showMore.find('.navigation-menu-icon').text()).toBe('')
    expect(showMore.find('.text-muted').exists()).toBe(true)

    await showMore.trigger('click')
    await waitForSidebar()

    expect(mockRpcRequest).toHaveBeenNthCalledWith(2, 'thread/list', {
      cursor: 'next-page',
      limit: 5,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      cwd: '/repo/codori'
    })
    expect(wrapper.findAll('[data-kind="thread"]')).toHaveLength(7)
    expect(wrapper.text()).toContain('Thread 6')
    expect(wrapper.text()).toContain('Thread 7')
    expect(wrapper.find('[data-kind="more"]').exists()).toBe(false)
  })

  it('ignores repeated Show more selection while the next page is pending', async () => {
    const nextPage = createDeferred<ThreadListResponse>()
    mockRpcRequest
      .mockResolvedValueOnce(makeThreadListResponse(5, 'next-page'))
      .mockReturnValueOnce(nextPage.promise)

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()

    const showMore = wrapper.get('[data-kind="more"]')
    await showMore.trigger('click')
    await showMore.trigger('click')

    expect(mockRpcRequest).toHaveBeenCalledTimes(2)
    expect(wrapper.findAll('[data-kind="thread"]')).toHaveLength(5)

    nextPage.resolve(makeThreadListResponse(1, null, 6))
    await waitForSidebar()

    expect(wrapper.findAll('[data-kind="thread"]')).toHaveLength(6)
  })

  it('emphasizes the active inline thread row', async () => {
    mockRoute.params = {
      projectId: 'codori',
      threadId: 'thread-1'
    }
    mockRpcRequest.mockResolvedValue(makeThreadListResponse(2))

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()

    const activeProject = wrapper.get('[data-kind="project"][data-to="/projects/codori"]')
    const activeThread = wrapper.get('[data-kind="thread"][data-to="/projects/codori/threads/thread-1"]')
    const inactiveThread = wrapper.get('[data-kind="thread"][data-to="/projects/codori/threads/thread-2"]')
    expect(activeProject.attributes('data-active')).toBe('true')
    expect(activeProject.classes()).toContain('before:bg-primary/5')
    expect(activeProject.classes()).not.toContain('ring-1')
    expect(activeProject.classes()).not.toContain('shadow-sm')
    expect(activeThread.attributes('data-depth')).toBe('1')
    expect(activeThread.attributes('data-active')).toBe('true')
    expect(activeThread.classes()).toContain('before:bg-primary/5')
    expect(activeThread.classes()).not.toContain('ring-1')
    expect(activeThread.classes()).not.toContain('shadow-sm')
    expect(inactiveThread.attributes('data-depth')).toBe('1')
    expect(inactiveThread.attributes('data-active')).toBe('false')
    expect(inactiveThread.classes()).not.toContain('before:bg-primary/5')
  })

  it('opens the next active project group after an in-app route transition', async () => {
    mockRpcRequest.mockResolvedValue(makeThreadListResponse(2))

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()
    expect(wrapper.get('.navigation-menu-stub').attributes('data-model-value')).toBe('["project:codori"]')

    mockRoute.params = {
      projectId: 'other',
      threadId: 'thread-2'
    }
    await waitForSidebar()

    expect(wrapper.get('.navigation-menu-stub').attributes('data-model-value')).toBe('["project:other"]')
  })

  it('keeps selected project inline rows synced with shared thread summaries', async () => {
    mockRpcRequest.mockResolvedValue(makeThreadListResponse(1))

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()

    expect(wrapper.text()).toContain('Thread 1')

    const summaries = useThreadSummaries(resolveProjectThreadSummaryKey('codori'))
    summaries.syncThreadSummary({
      id: 'thread-new',
      name: 'Fresh thread',
      preview: '',
      updatedAt: 2_000
    })
    summaries.updateThreadSummaryTitle('thread-1', 'Renamed thread', 3_000)
    await nextTick()

    expect(wrapper.text()).toContain('Fresh thread')
    expect(wrapper.text()).toContain('Renamed thread')
    expect(wrapper.text()).not.toContain('Thread 1')
  })

  it('does not render stale inline threads under a newly selected project', async () => {
    mockRpcRequest.mockResolvedValueOnce(makeThreadListResponse(2))

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()

    expect(wrapper.text()).toContain('Thread 1')

    mockRpcRequest.mockResolvedValueOnce(makeThreadListResponse(0))
    mockRoute.params = {
      projectId: 'other'
    }
    await nextTick()

    expect(wrapper.text()).not.toContain('Thread 1')
    expect(wrapper.text()).toContain('Loading threads...')
  })

  it('waits for an in-flight project refresh before loading selected project threads', async () => {
    mockProjects.value = []
    mockProjectsLoaded.value = false
    mockProjectsLoading.value = true
    mockRpcRequest.mockResolvedValue(makeThreadListResponse(1))

    const wrapper = mountSidebar({
      collapsed: false
    })
    await waitForSidebar()

    expect(mockRefreshProjects).toHaveBeenCalledTimes(1)
    expect(mockGetClient).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Project "codori" was not found.')

    mockProjects.value = [
      makeProject({
        projectId: 'codori',
        projectPath: '/repo/codori'
      })
    ]
    mockProjectsLoaded.value = true
    mockProjectsLoading.value = false
    await waitForSidebar()

    expect(mockGetClient).toHaveBeenCalledWith('codori')
    expect(mockRpcRequest).toHaveBeenCalledWith('thread/list', {
      limit: 5,
      sortKey: 'updated_at',
      sortDirection: 'desc',
      cwd: '/repo/codori'
    })
    expect(wrapper.text()).toContain('Thread 1')
  })

  it('refreshes projects when mounted collapsed with an active project', async () => {
    mockProjects.value = []
    mockProjectsLoaded.value = false
    mockProjectsLoading.value = false
    mockRpcRequest.mockResolvedValue(makeThreadListResponse(1))

    mountSidebar({
      collapsed: true
    })
    await waitForSidebar()

    expect(mockRefreshProjects).toHaveBeenCalledTimes(1)
    expect(mockGetClient).not.toHaveBeenCalled()
  })

  it('does not continue a stale stopped-project fetch after project selection changes', async () => {
    const startProject = createDeferred<unknown>()
    mockProjects.value = [
      makeProject({
        projectId: 'codori',
        projectPath: '/repo/codori',
        status: 'stopped',
        pid: null,
        port: null
      }),
      makeProject({
        projectId: 'other',
        projectPath: '/repo/other'
      })
    ]
    mockStartProject.mockReturnValue(startProject.promise)
    mockRpcRequest.mockResolvedValue(makeThreadListResponse(0))

    mountSidebar({
      collapsed: false
    })
    await waitForSidebar()

    expect(mockStartProject).toHaveBeenCalledWith('codori')

    mockRoute.params = {
      projectId: 'other'
    }
    await waitForSidebar()

    startProject.resolve({})
    await waitForSidebar()

    expect(mockGetClient).not.toHaveBeenCalledWith('codori')
    expect(mockGetClient).toHaveBeenCalledWith('other')
  })

  it('keeps collapsed sidebar project-only and does not fetch inline threads', async () => {
    mockRpcRequest.mockResolvedValue(makeThreadListResponse(2))

    const wrapper = mountSidebar({
      collapsed: true
    })
    await waitForSidebar()

    expect(mockGetClient).not.toHaveBeenCalled()
    expect(mockRpcRequest).not.toHaveBeenCalled()
    expect(wrapper.text()).not.toContain('Thread 1')
    expect(wrapper.findAll('[data-kind="thread"]')).toHaveLength(0)
  })
})

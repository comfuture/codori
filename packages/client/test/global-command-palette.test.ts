/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import type { VueWrapper } from '@vue/test-utils'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import GlobalCommandPalette from '../app/components/GlobalCommandPalette.vue'
import {
  isEditableShortcutTarget,
  isGlobalCommandPaletteShortcut
} from '../app/utils/global-command-palette-shortcut'

const mockRouterPush = vi.fn()
const mockRefreshProjects = vi.fn()
const mockRefreshChats = vi.fn()
const mockStartProject = vi.fn()
const mockGetClient = vi.fn()
const mockProjects = ref<Array<{
  projectId: string
  projectPath: string
  status: 'running' | 'stopped' | 'error'
  error: string | null
}>>([])
const mockProjectsLoaded = ref(false)
const mockProjectsLoading = ref(false)
const mockChats = ref<Array<{
  chatId: string
  chatPath: string
  title: string | null
  createdAt: number
  updatedAt: number | null
  status: 'running' | 'stopped' | 'error'
  error: string | null
  threadId: string | null
}>>([])
const mockChatsLoaded = ref(false)
const mockChatsLoading = ref(false)
const mountedWrappers: VueWrapper[] = []
const mockThreadResponses = new Map<string, unknown[]>()

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
    startProject: mockStartProject
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
    loaded: mockChatsLoaded,
    loading: mockChatsLoading,
    refreshChats: mockRefreshChats
  })
}))

const ModalStub = defineComponent({
  name: 'ModalStub',
  props: {
    open: {
      type: Boolean,
      default: false
    }
  },
  emits: ['update:open'],
  setup(props, { slots }) {
    return () => props.open
      ? h('div', { class: 'modal-stub' }, slots.content?.())
      : null
  }
})

const CommandPaletteStub = defineComponent({
  name: 'CommandPaletteStub',
  props: {
    groups: {
      type: Array,
      default: () => []
    },
    searchTerm: {
      type: String,
      default: ''
    }
  },
  emits: ['update:searchTerm', 'update:open'],
  setup(props, { emit }) {
    const visibleGroups = computed(() => {
      const search = props.searchTerm.trim().toLowerCase()
      return (props.groups as Array<{
        id: string
        label?: string
        ignoreFilter?: boolean
        items?: Array<Record<string, unknown>>
      }>).map(group => ({
        ...group,
        items: (group.items ?? []).filter((item) => {
          if (!search || group.ignoreFilter) {
            return true
          }

          return `${String(item.label ?? '')} ${String(item.suffix ?? '')}`.toLowerCase().includes(search)
        })
      })).filter(group => group.items.length > 0)
    })

    return () => h('div', { class: 'command-palette-stub' }, [
      h('input', {
        class: 'command-search',
        value: props.searchTerm,
        onInput: (event: Event) => emit('update:searchTerm', (event.target as HTMLInputElement).value)
      }),
      h('button', {
        type: 'button',
        class: 'command-close',
        onClick: () => emit('update:open', false)
      }, 'Close'),
      ...visibleGroups.value.flatMap(group => [
        h('div', { class: 'command-group' }, group.label),
        ...(group.items ?? []).map(item => h('button', {
          type: 'button',
          class: 'command-item',
          disabled: Boolean(item.disabled),
          onClick: () => {
            const onSelect = item.onSelect
            if (typeof onSelect === 'function') {
              onSelect(new Event('select'))
            }
          }
        }, `${String(item.label ?? '')} ${String(item.suffix ?? '')}`))
      ])
    ])
  }
})

const mountPalette = (props: Record<string, unknown> = {}) => {
  const wrapper = mount(GlobalCommandPalette, {
    props,
    attachTo: document.body,
    global: {
      stubs: {
        UModal: ModalStub,
        UCommandPalette: CommandPaletteStub
      }
    }
  })
  mountedWrappers.push(wrapper)
  return wrapper
}

const dispatchShortcut = (init: KeyboardEventInit) => {
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    bubbles: true,
    cancelable: true,
    ...init
  })
  window.dispatchEvent(event)
  return event
}

describe('global command palette shortcut helpers', () => {
  it('matches the platform command shortcut only with the expected modifier', () => {
    expect(isGlobalCommandPaletteShortcut({
      key: 'k',
      metaKey: true,
      ctrlKey: false,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      isComposing: false
    }, 'MacIntel')).toBe(true)

    expect(isGlobalCommandPaletteShortcut({
      key: 'k',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      isComposing: false
    }, 'Linux x86_64')).toBe(true)

    expect(isGlobalCommandPaletteShortcut({
      key: 'k',
      metaKey: false,
      ctrlKey: true,
      altKey: false,
      shiftKey: false,
      defaultPrevented: false,
      isComposing: false
    }, 'MacIntel')).toBe(false)
  })

  it('detects editable shortcut targets', () => {
    const input = document.createElement('input')
    const button = document.createElement('button')
    const editable = document.createElement('div')

    editable.contentEditable = 'true'

    expect(isEditableShortcutTarget(input)).toBe(true)
    expect(isEditableShortcutTarget(editable)).toBe(true)
    expect(isEditableShortcutTarget(button)).toBe(false)
  })
})

describe('global command palette', () => {
  let platformSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    document.body.innerHTML = ''
    mockRouterPush.mockReset()
    mockRefreshProjects.mockReset().mockResolvedValue(undefined)
    mockRefreshChats.mockReset().mockResolvedValue(undefined)
    mockStartProject.mockReset().mockResolvedValue(undefined)
    mockGetClient.mockReset().mockImplementation((projectId: string) => ({
      request: vi.fn().mockResolvedValue({
        data: mockThreadResponses.get(projectId) ?? [],
        nextCursor: null
      })
    }))
    mockThreadResponses.clear()
    mockProjects.value = [
      {
        projectId: 'team/api',
        projectPath: '/Users/comfuture/Project/team-api',
        status: 'stopped',
        error: null
      },
      {
        projectId: 'codori',
        projectPath: '/Users/comfuture/Project/codori',
        status: 'running',
        error: null
      }
    ]
    mockProjectsLoaded.value = false
    mockProjectsLoading.value = false
    mockChats.value = [{
      chatId: 'chat alpha',
      chatPath: '/Users/comfuture/Documents/Chats/chat-alpha',
      title: 'Design notes',
      createdAt: Date.UTC(2026, 0, 2, 3, 4),
      updatedAt: null,
      status: 'stopped',
      error: null,
      threadId: null
    }]
    mockChatsLoaded.value = false
    mockChatsLoading.value = false
    platformSpy = vi.spyOn(window.navigator, 'platform', 'get').mockReturnValue('MacIntel')
  })

  afterEach(() => {
    for (const wrapper of mountedWrappers.splice(0)) {
      wrapper.unmount()
    }
    vi.useRealTimers()
    platformSpy.mockRestore()
  })

  it('opens on the macOS command shortcut and refreshes unloaded data', async () => {
    const wrapper = mountPalette()

    dispatchShortcut({ metaKey: true })
    await nextTick()

    expect(wrapper.text()).toContain('New Chat')
    expect(wrapper.text()).toContain('Recent Chats')
    expect(wrapper.text()).toContain('Design notes')
    expect(wrapper.text()).toContain('Recent Projects')
    expect(wrapper.text()).toContain('team/api')
    expect(mockRefreshChats).toHaveBeenCalledTimes(1)
    expect(mockRefreshProjects).toHaveBeenCalledTimes(1)
  })

  it('opens from an external model and emits close updates', async () => {
    const wrapper = mountPalette({
      open: true
    })

    await nextTick()

    expect(wrapper.text()).toContain('New Chat')

    await wrapper.get('.command-close').trigger('click')

    expect(wrapper.emitted('update:open')?.[0]).toEqual([false])
  })

  it('uses Ctrl+K on non-macOS platforms', async () => {
    platformSpy.mockReturnValue('Linux x86_64')
    const wrapper = mountPalette()

    dispatchShortcut({ ctrlKey: true })
    await nextTick()

    expect(wrapper.text()).toContain('New Chat')
  })

  it('does not open from editable targets', async () => {
    const wrapper = mountPalette()
    const input = document.createElement('input')
    document.body.append(input)

    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true
    }))
    await nextTick()

    expect(wrapper.text()).not.toContain('New Chat')
  })

  it('does not open from the terminal shortcut boundary', async () => {
    const wrapper = mountPalette()
    const terminal = document.createElement('div')
    const canvas = document.createElement('canvas')
    terminal.dataset.codoriShortcuts = 'ignore'
    terminal.append(canvas)
    document.body.append(terminal)

    canvas.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true
    }))
    await nextTick()

    expect(wrapper.text()).not.toContain('New Chat')
  })

  it('routes and closes after selecting an action, chat, or project', async () => {
    mockProjectsLoaded.value = true
    mockChatsLoaded.value = true
    mockRouterPush.mockResolvedValue(undefined)
    const wrapper = mountPalette()

    dispatchShortcut({ metaKey: true })
    await nextTick()

    await wrapper.findAll('.command-item').find(button => button.text().includes('New Chat'))!.trigger('click')
    await flushPromises()

    expect(mockRouterPush).toHaveBeenCalledWith('/chats')
    expect(wrapper.text()).not.toContain('New Chat')

    dispatchShortcut({ metaKey: true })
    await nextTick()
    await wrapper.findAll('.command-item').find(button => button.text().includes('Design notes'))!.trigger('click')
    await flushPromises()

    expect(mockRouterPush).toHaveBeenCalledWith('/chats/chat%20alpha')

    dispatchShortcut({ metaKey: true })
    await nextTick()
    await wrapper.findAll('.command-item').find(button => button.text().includes('team/api'))!.trigger('click')
    await flushPromises()

    expect(mockRouterPush).toHaveBeenCalledWith('/projects/team/api')
    expect(wrapper.text()).not.toContain('team/api')
  })

  it('filters palette entries through the command palette search term', async () => {
    mockProjectsLoaded.value = true
    mockChatsLoaded.value = true
    const wrapper = mountPalette()

    dispatchShortcut({ metaKey: true })
    await nextTick()

    await wrapper.get('.command-search').setValue('codori')

    expect(wrapper.text()).toContain('codori')
    expect(wrapper.text()).not.toContain('team/api')
    expect(wrapper.text()).not.toContain('Design notes')
  })

  it('searches matching project thread titles while typing', async () => {
    vi.useFakeTimers()
    mockProjectsLoaded.value = true
    mockChatsLoaded.value = true
    mockProjects.value = [
      {
        projectId: 'team/api',
        projectPath: '/Users/comfuture/Project/team-api',
        status: 'running',
        error: null
      },
      {
        projectId: 'codori',
        projectPath: '/Users/comfuture/Project/codori',
        status: 'stopped',
        error: null
      }
    ]
    mockRouterPush.mockResolvedValue(undefined)
    mockThreadResponses.set('team/api', [{
      id: 'thread-1',
      name: 'Review API plan',
      preview: 'Fallback preview',
      updatedAt: 1_767_000_000
    }])
    mockThreadResponses.set('codori', [])
    const wrapper = mountPalette()

    dispatchShortcut({ metaKey: true })
    await nextTick()
    await wrapper.get('.command-search').setValue('review')
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(mockStartProject).not.toHaveBeenCalled()
    expect(mockGetClient).toHaveBeenCalledWith('team/api')
    expect(mockGetClient).not.toHaveBeenCalledWith('codori')
    const teamClient = mockGetClient.mock.results.find(result => result.type === 'return')?.value
    expect(teamClient.request).toHaveBeenCalledWith('thread/list', {
      limit: 3,
      sortKey: 'updated_at',
      cwd: '/Users/comfuture/Project/team-api',
      searchTerm: 'review'
    })
    expect(wrapper.text()).toContain('Matching Threads')
    expect(wrapper.text()).toContain('Review API plan')
    expect(wrapper.text()).toContain('team/api')

    await wrapper.findAll('.command-item').find(button => button.text().includes('Review API plan'))!.trigger('click')
    await flushPromises()

    expect(mockRouterPush).toHaveBeenCalledWith('/projects/team/api/threads/thread-1')
    expect(wrapper.text()).not.toContain('Review API plan')
  })

  it('waits for in-flight project loading before searching threads', async () => {
    vi.useFakeTimers()
    mockProjects.value = []
    mockProjectsLoaded.value = false
    mockProjectsLoading.value = true
    mockChatsLoaded.value = true
    mockThreadResponses.set('codori', [{
      id: 'thread-codori',
      name: 'Codori command palette work',
      preview: 'Fallback preview',
      updatedAt: 1_767_000_001
    }])
    const wrapper = mountPalette()

    dispatchShortcut({ metaKey: true })
    await nextTick()
    await wrapper.get('.command-search').setValue('codori')
    await nextTick()
    await vi.advanceTimersByTimeAsync(250)
    await flushPromises()

    expect(mockStartProject).not.toHaveBeenCalled()

    mockProjects.value = [{
      projectId: 'codori',
      projectPath: '/Users/comfuture/Project/codori',
      status: 'running',
      error: null
    }]
    mockProjectsLoaded.value = true
    mockProjectsLoading.value = false
    await nextTick()
    await flushPromises()

    expect(mockStartProject).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Matching Threads')
    expect(wrapper.text()).toContain('Codori command palette work')
  })
})

/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref, type VNode } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceFilesPanel from '../app/components/WorkspaceFilesPanel.vue'
import { useState } from '#imports'
import {
  useWorkspaceFiles,
  type WorkspaceFileTreeNode
} from '../app/composables/useWorkspaceFiles'
import type { WorkspaceLocalFileScope } from '../shared/local-files'

const fetchMock = vi.fn()
const clipboardWriteMock = vi.fn()

const PassThroughStub = defineComponent({
  setup(_, { slots }) {
    return () => h('div', slots.default?.())
  }
})

const ButtonStub = defineComponent({
  inheritAttrs: false,
  props: {
    label: { type: String, default: '' },
    disabled: { type: Boolean, default: false }
  },
  setup(props, { attrs, slots }) {
    return () => h('button', {
      ...attrs,
      disabled: props.disabled
    }, slots.default?.() ?? props.label)
  }
})

const ModalStub = defineComponent({
  props: {
    open: { type: Boolean, default: false },
    description: { type: String, default: undefined }
  },
  setup(props, { slots }) {
    return () => props.open
      ? h('div', { class: 'modal-stub' }, [
          slots.actions?.(),
          slots.body?.(),
          slots.footer?.()
        ])
      : null
  }
})

const LocalFilePreviewStub = defineComponent({
  name: 'LocalFilePreview',
  props: {
    path: { type: String, required: true }
  },
  setup(props) {
    return () => h('div', {
      'data-preview-path': props.path
    })
  }
})

const IconStub = defineComponent({
  inheritAttrs: false,
  props: {
    name: { type: String, required: true }
  },
  setup(props, { attrs }) {
    return () => h('span', {
      ...attrs,
      'data-icon': props.name
    })
  }
})

const BreadcrumbStub = defineComponent({
  props: {
    items: { type: Array, default: () => [] }
  },
  setup(props, { slots }) {
    return () => h('nav', (props.items as Array<Record<string, unknown>>).map(item =>
      slots.item?.({ item })
    ))
  }
})

const TreeStub = defineComponent({
  inheritAttrs: false,
  props: {
    items: { type: Array, default: () => [] },
    expanded: { type: Array, default: () => [] },
    ui: { type: Object, default: () => ({}) },
    onToggle: { type: Function, default: undefined },
    onSelect: { type: Function, default: undefined }
  },
  setup(props, { attrs, slots }) {
    const renderNodes = (nodes: WorkspaceFileTreeNode[]): VNode[] => nodes.map(node => {
      const expanded = (props.expanded as string[]).includes(node.key)
      const label = slots['item-label']?.({ item: node }) ?? node.label
      const children: VNode[] = expanded && node.children
        ? renderNodes(node.children)
        : []

      return h('div', { key: node.key }, [
        h('button', {
          'data-tree-path': node.key,
          disabled: node.disabled,
          onClick: () => {
            if (node.entry?.kind === 'directory') {
              props.onToggle?.({ detail: { isExpanded: expanded } }, node)
              const updateExpanded = attrs['onUpdate:expanded'] as ((paths: string[]) => void) | undefined
              updateExpanded?.(
                expanded
                  ? (props.expanded as string[]).filter(path => path !== node.key)
                  : [...props.expanded as string[], node.key]
              )
            }
            props.onSelect?.(new Event('select'), node)
          }
        }, label),
        ...children
      ])
    })

    return () => h('div', { class: 'tree-stub' }, renderNodes(props.items as WorkspaceFileTreeNode[]))
  }
})

const AlertStub = defineComponent({
  props: {
    title: { type: String, default: '' },
    description: { type: String, default: '' }
  },
  setup(props) {
    return () => h('div', `${props.title} ${props.description}`)
  }
})

const mountPanel = (workspace: WorkspaceLocalFileScope = { kind: 'project', id: 'demo' }) =>
  mount(WorkspaceFilesPanel, {
    props: {
      workspace,
      workspaceLabel: workspace.kind === 'project' ? 'demo' : 'Scratch chat'
    },
    global: {
      stubs: {
        UTooltip: PassThroughStub,
        UButton: ButtonStub,
        UModal: ModalStub,
        UBreadcrumb: BreadcrumbStub,
        UScrollArea: PassThroughStub,
        USkeleton: PassThroughStub,
        UTree: TreeStub,
        UAlert: AlertStub,
        UBadge: PassThroughStub,
        UIcon: IconStub,
        LocalFilePreview: LocalFilePreviewStub
      }
    }
  })

const directoryResponse = (
  path: string,
  entries: Array<Record<string, unknown>>,
  truncated = false
) => ({
  directory: {
    path,
    entries,
    truncated,
    limit: 200
  }
})

const entry = (input: Partial<Record<string, unknown>> & { name: string, path: string }) => ({
  kind: 'file',
  size: 5,
  updatedAt: 1,
  isSymlink: false,
  accessible: true,
  hidden: false,
  ignored: false,
  ...input
})

describe('WorkspaceFilesPanel', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    clipboardWriteMock.mockReset()
    vi.stubGlobal('$fetch', fetchMock)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: clipboardWriteMock }
    })
    useState<Record<string, unknown>>('codori-workspace-files', () => ({})).value = {}
  })

  it('keeps tree rows and labels left aligned beside their icons', async () => {
    fetchMock.mockResolvedValue(directoryResponse('', [
      entry({ name: 'README.md', path: 'README.md' })
    ]))
    const wrapper = mountPanel()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()
    const tree = wrapper.findComponent(TreeStub)

    expect(tree.props('ui')).toMatchObject({
      link: expect.stringContaining('justify-start'),
      linkLabel: expect.stringContaining('text-left')
    })
  })

  it('loads directories lazily and previews selected files without closing the explorer', async () => {
    fetchMock.mockImplementation((url: string) => {
      const parsed = new URL(url, 'http://localhost')
      const path = parsed.searchParams.get('path') ?? ''
      return path === 'src'
        ? Promise.resolve(directoryResponse('src', [entry({ name: 'app.ts', path: 'src/app.ts' })]))
        : Promise.resolve(directoryResponse('', [
            entry({ name: 'src', path: 'src', kind: 'directory', size: null }),
            entry({ name: 'README.md', path: 'README.md' })
          ]))
    })

    const wrapper = mountPanel()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(new URL(fetchMock.mock.calls[0]?.[0], 'http://localhost').searchParams.get('path')).toBe('')
    expect(wrapper.find('[data-tree-path="src/app.ts"]').exists()).toBe(false)

    await wrapper.get('[data-tree-path="src"]').trigger('click')
    await flushPromises()
    await nextTick()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(new URL(fetchMock.mock.calls[1]?.[0], 'http://localhost').searchParams.get('path')).toBe('src')
    await wrapper.get('[data-tree-path="src/app.ts"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('.modal-stub').exists()).toBe(true)
    expect(wrapper.get('[data-preview-path="src/app.ts"]').attributes('data-preview-path')).toBe('src/app.ts')
  })

  it('shows an empty preview prompt until a file is selected', async () => {
    fetchMock.mockResolvedValue(directoryResponse('', [
      entry({ name: 'README.md', path: 'README.md' })
    ]))

    const wrapper = mountPanel()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Select a file from the tree to preview it.')
    expect(wrapper.find('[data-preview-path]').exists()).toBe(false)
    expect(wrapper.get('[data-icon="i-lucide-file-search-2"]').classes()).toContain('text-muted/45')
    expect(wrapper.findComponent(ModalStub).props('description')).toBeUndefined()
  })

  it('refreshes the active directory and copies its relative path', async () => {
    fetchMock.mockImplementation((url: string) => {
      const path = new URL(url, 'http://localhost').searchParams.get('path') ?? ''
      return Promise.resolve(path === 'src'
        ? directoryResponse('src', [])
        : directoryResponse('', [entry({ name: 'src', path: 'src', kind: 'directory', size: null })]))
    })
    clipboardWriteMock.mockResolvedValue(undefined)

    const wrapper = mountPanel()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-tree-path="src"]').trigger('click')
    await flushPromises()

    const treeActions = wrapper.get('[aria-label="File tree actions"]')
    expect(treeActions.find('[aria-label="Refresh current folder"]').exists()).toBe(true)
    expect(treeActions.find('[aria-label="Copy relative path"]').exists()).toBe(true)

    await treeActions.get('[aria-label="Copy relative path"]').trigger('click')
    await flushPromises()
    expect(clipboardWriteMock).toHaveBeenCalledWith('src')
    expect(wrapper.text()).toContain('Copied src')

    await treeActions.get('[aria-label="Refresh current folder"]').trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.filter(([url]) =>
      new URL(url, 'http://localhost').searchParams.get('path') === 'src'
    )).toHaveLength(2)
  })

  it('reports clipboard failure when the Clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined
    })
    fetchMock.mockResolvedValue(directoryResponse('', [
      entry({ name: 'README.md', path: 'README.md' })
    ]))

    const wrapper = mountPanel()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-tree-path="README.md"]').trigger('click')
    await wrapper.get('[aria-label="Copy relative path"]').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Could not copy the relative path.')
  })

  it('shows truncation without exposing generated-folder controls', async () => {
    fetchMock.mockResolvedValue(directoryResponse('', [
      entry({ name: 'README.md', path: 'README.md' })
    ], true))

    const wrapper = mountPanel({ kind: 'chat', id: 'chat-test' })
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('This directory is limited to 200 entries.')
    expect(wrapper.text()).not.toContain('Show generated folders')
    expect(wrapper.find('input[type="checkbox"]').exists()).toBe(false)
    const initialUrl = new URL(fetchMock.mock.calls[0]?.[0], 'http://localhost')
    expect(initialUrl.pathname).toBe('/api/chats/chat-test/files')
    expect(initialUrl.searchParams.has('showIgnored')).toBe(false)
  })

  it('keeps root errors visible and recoverable', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce(directoryResponse('', []))

    const wrapper = mountPanel()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load workspace files')
    expect(wrapper.text()).toContain('Permission denied')

    const retry = wrapper.findAll('button').find(button => button.text() === 'Retry')
    expect(retry).toBeDefined()
    await retry?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('This folder is empty.')
  })

  it('shows a recoverable nested-directory error', async () => {
    fetchMock.mockImplementation((url: string) => {
      const path = new URL(url, 'http://localhost').searchParams.get('path') ?? ''
      if (path === 'src' && fetchMock.mock.calls.filter(([calledUrl]) =>
        new URL(calledUrl, 'http://localhost').searchParams.get('path') === 'src'
      ).length === 1) {
        return Promise.reject(new Error('Folder disappeared'))
      }
      return Promise.resolve(path === 'src'
        ? directoryResponse('src', [])
        : directoryResponse('', [entry({ name: 'src', path: 'src', kind: 'directory', size: null })]))
    })

    const wrapper = mountPanel()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-tree-path="src"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Could not load folder')
    expect(wrapper.text()).toContain('Folder disappeared')

    const retry = wrapper.findAll('button').find(button => button.text() === 'Retry folder')
    expect(retry).toBeDefined()
    await retry?.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('This folder is empty.')
  })

  it('invalidates pending nested requests when the generated-folder policy changes', async () => {
    let resolveOldRequest!: (value: ReturnType<typeof directoryResponse>) => void
    const oldRequest = new Promise<ReturnType<typeof directoryResponse>>((resolve) => {
      resolveOldRequest = resolve
    })
    fetchMock.mockImplementation((url: string) => {
      const parsed = new URL(url, 'http://localhost')
      const path = parsed.searchParams.get('path') ?? ''
      if (path === 'src' && parsed.searchParams.get('showIgnored') !== 'true') {
        return oldRequest
      }
      if (path === 'src') {
        return Promise.resolve(directoryResponse('src', [entry({ name: 'fresh.ts', path: 'src/fresh.ts' })]))
      }
      return Promise.resolve(directoryResponse('', [
        entry({ name: 'src', path: 'src', kind: 'directory', size: null })
      ]))
    })

    const files = useWorkspaceFiles(ref<WorkspaceLocalFileScope>({ kind: 'project', id: 'demo' }))
    await files.loadDirectory('')
    const src = files.snapshot.value.listings['']?.entries[0]
    expect(src).toBeDefined()
    files.selectEntry(src!)
    files.snapshot.value.expandedPaths = ['src']
    const pendingOldRequest = files.loadDirectory('src')
    await files.setShowIgnored(true)

    expect(files.snapshot.value.listings.src?.entries.map(item => item.path)).toEqual(['src/fresh.ts'])
    resolveOldRequest(directoryResponse('src', [entry({ name: 'stale.ts', path: 'src/stale.ts' })]))
    await pendingOldRequest
    await flushPromises()
    expect(files.snapshot.value.listings.src?.entries.map(item => item.path)).toEqual(['src/fresh.ts'])
  })

  it('does not restore filter state into a workspace selected during reload', async () => {
    let resolveFilteredRoot!: (value: ReturnType<typeof directoryResponse>) => void
    const filteredRoot = new Promise<ReturnType<typeof directoryResponse>>((resolve) => {
      resolveFilteredRoot = resolve
    })
    fetchMock.mockImplementation((url: string) => {
      const parsed = new URL(url, 'http://localhost')
      const path = parsed.searchParams.get('path') ?? ''
      if (parsed.pathname.includes('/projects/') && path === '' && parsed.searchParams.get('showIgnored') === 'true') {
        return filteredRoot
      }
      return Promise.resolve(path === 'src'
        ? directoryResponse('src', [])
        : directoryResponse('', [entry({ name: 'src', path: 'src', kind: 'directory', size: null })]))
    })

    const workspace = ref<WorkspaceLocalFileScope>({ kind: 'project', id: 'demo' })
    const files = useWorkspaceFiles(workspace)
    await files.loadDirectory('')
    const src = files.snapshot.value.listings['']?.entries[0]
    expect(src).toBeDefined()
    files.selectEntry(src!)
    files.snapshot.value.expandedPaths = ['src']
    await files.loadDirectory('src')
    const filterReload = files.setShowIgnored(true)
    workspace.value = { kind: 'chat', id: 'chat-test' }
    resolveFilteredRoot(directoryResponse('', [
      entry({ name: 'src', path: 'src', kind: 'directory', size: null })
    ]))
    await filterReload
    await flushPromises()

    expect(fetchMock.mock.calls.some(([url]) => {
      const parsed = new URL(url, 'http://localhost')
      return parsed.pathname.includes('/chats/chat-test/files')
        && parsed.searchParams.get('path') === 'src'
    })).toBe(false)
  })

  it('resets stale navigation when a filter reload fails before retry', async () => {
    let filteredRootRequests = 0
    fetchMock.mockImplementation((url: string) => {
      const parsed = new URL(url, 'http://localhost')
      const path = parsed.searchParams.get('path') ?? ''
      if (path === '' && parsed.searchParams.get('showIgnored') === 'true') {
        filteredRootRequests += 1
        if (filteredRootRequests === 1) {
          return Promise.reject(new Error('Root unavailable'))
        }
      }
      return Promise.resolve(path === 'src'
        ? directoryResponse('src', [entry({ name: 'fresh.ts', path: 'src/fresh.ts' })])
        : directoryResponse('', [entry({ name: 'src', path: 'src', kind: 'directory', size: null })]))
    })

    const files = useWorkspaceFiles(ref<WorkspaceLocalFileScope>({ kind: 'project', id: 'demo' }))
    await files.loadDirectory('')
    const src = files.snapshot.value.listings['']?.entries[0]
    expect(src).toBeDefined()
    files.selectEntry(src!)
    files.snapshot.value.expandedPaths = ['src']
    await files.loadDirectory('src')

    await files.setShowIgnored(true)
    expect(files.rootError.value).toBe('Root unavailable')
    expect(files.snapshot.value.currentPath).toBe('')
    expect(files.snapshot.value.selectedPath).toBeNull()

    await files.loadDirectory('', { force: true })
    expect(files.snapshot.value.listings.src).toBeUndefined()
    const restoredSrc = files.snapshot.value.listings['']?.entries[0]
    expect(restoredSrc).toBeDefined()
    files.selectEntry(restoredSrc!)
    await files.loadDirectory('src')
    expect(files.snapshot.value.listings.src?.entries.map(item => item.path)).toEqual(['src/fresh.ts'])
  })

  it('does not leak stale directory results across workspace switches', async () => {
    let resolveProjectRequest!: (value: ReturnType<typeof directoryResponse>) => void
    const projectRequest = new Promise<ReturnType<typeof directoryResponse>>((resolve) => {
      resolveProjectRequest = resolve
    })
    fetchMock.mockImplementation((url: string) => {
      const parsed = new URL(url, 'http://localhost')
      return parsed.pathname.includes('/projects/')
        ? projectRequest
        : Promise.resolve(directoryResponse('', [entry({ name: 'chat.txt', path: 'chat.txt' })]))
    })

    const wrapper = mountPanel()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await wrapper.setProps({
      workspace: { kind: 'chat', id: 'chat-test' },
      workspaceLabel: 'Scratch chat'
    })
    await nextTick()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-tree-path="chat.txt"]').exists()).toBe(true)

    resolveProjectRequest(directoryResponse('', [entry({ name: 'project.txt', path: 'project.txt' })]))
    await flushPromises()
    expect(wrapper.find('[data-tree-path="chat.txt"]').exists()).toBe(true)
    expect(wrapper.find('[data-tree-path="project.txt"]').exists()).toBe(false)
  })
})

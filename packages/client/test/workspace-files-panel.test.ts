/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, type VNode } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceFilesPanel from '../app/components/WorkspaceFilesPanel.vue'
import { useLocalFileViewer } from '../app/composables/useLocalFileViewer'
import { useState } from '#imports'
import type { WorkspaceFileTreeNode } from '../app/composables/useWorkspaceFiles'
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

const SlideoverStub = defineComponent({
  props: {
    open: { type: Boolean, default: false }
  },
  setup(props, { slots }) {
    return () => props.open
      ? h('div', { class: 'slideover-stub' }, [
          slots.actions?.(),
          slots.body?.(),
          slots.footer?.()
        ])
      : null
  }
})

const CheckboxStub = defineComponent({
  props: {
    modelValue: { type: Boolean, default: false },
    label: { type: String, default: '' }
  },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('label', [
      h('input', {
        type: 'checkbox',
        checked: props.modelValue,
        onChange: () => emit('update:modelValue', !props.modelValue)
      }),
      props.label
    ])
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
        USlideover: SlideoverStub,
        UCheckbox: CheckboxStub,
        UBreadcrumb: BreadcrumbStub,
        UScrollArea: PassThroughStub,
        USkeleton: PassThroughStub,
        UTree: TreeStub,
        UAlert: AlertStub,
        UBadge: PassThroughStub
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
    const { state } = useLocalFileViewer()
    state.value = {
      open: false,
      workspace: null,
      projectId: null,
      path: null,
      line: null,
      column: null
    }
  })

  it('loads directories lazily and opens selected files in the existing viewer', async () => {
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
    const slideover = wrapper.findComponent(SlideoverStub)
    await wrapper.get('[data-tree-path="src/app.ts"]').trigger('click')
    await flushPromises()

    const { state } = useLocalFileViewer()
    expect(state.value.open).toBe(false)
    slideover.vm.$emit('after:leave')
    await flushPromises()
    expect(state.value).toMatchObject({
      open: true,
      workspace: { kind: 'project', id: 'demo' },
      path: 'src/app.ts'
    })
    expect(wrapper.find('.slideover-stub').exists()).toBe(false)
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

    await wrapper.get('[aria-label="Copy relative path"]').trigger('click')
    await flushPromises()
    expect(clipboardWriteMock).toHaveBeenCalledWith('src')
    expect(wrapper.text()).toContain('Copied src')

    await wrapper.get('[aria-label="Refresh current folder"]').trigger('click')
    await flushPromises()
    expect(fetchMock.mock.calls.filter(([url]) =>
      new URL(url, 'http://localhost').searchParams.get('path') === 'src'
    )).toHaveLength(2)
  })

  it('shows truncation and reloads with generated folders enabled', async () => {
    fetchMock.mockResolvedValue(directoryResponse('', [
      entry({ name: 'README.md', path: 'README.md' })
    ], true))

    const wrapper = mountPanel({ kind: 'chat', id: 'chat-test' })
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('This directory is limited to 200 entries.')

    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()
    const secondUrl = new URL(fetchMock.mock.calls[1]?.[0], 'http://localhost')
    expect(secondUrl.pathname).toBe('/api/chats/chat-test/files')
    expect(secondUrl.searchParams.get('showIgnored')).toBe('true')
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

    const wrapper = mountPanel()
    await wrapper.get('[aria-label="Browse workspace files"]').trigger('click')
    await flushPromises()
    await wrapper.get('[data-tree-path="src"]').trigger('click')
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await flushPromises()
    resolveOldRequest(directoryResponse('src', [entry({ name: 'stale.ts', path: 'src/stale.ts' })]))
    await flushPromises()
    expect(wrapper.find('[data-tree-path="src/stale.ts"]').exists()).toBe(false)

    await wrapper.get('[data-tree-path="src"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-tree-path="src/fresh.ts"]').exists()).toBe(true)
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

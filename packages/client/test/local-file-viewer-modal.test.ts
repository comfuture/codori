/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LocalFileViewerModal from '../app/components/LocalFileViewerModal.vue'
import { useLocalFileViewer } from '../app/composables/useLocalFileViewer'

const fetchMock = vi.fn()

vi.mock('@comark/vue/plugins/highlight', () => ({
  default: () => ({ name: 'highlight' })
}))

vi.mock('@comark/vue', () => ({
  Comark: defineComponent({
    name: 'MockComark',
    props: {
      markdown: {
        type: String,
        required: true
      }
    },
    setup(props) {
      return () => {
        const lines = props.markdown
          .split('\n')
          .slice(1, -1)
        return h('pre', { class: 'shiki' }, [
          h('code', lines.map(line => h('span', { class: 'line' }, line)))
        ])
      }
    }
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
  setup(props, { slots }) {
    return () => props.open
      ? h('div', { class: 'modal-stub' }, slots.body?.())
      : null
  }
})

const ButtonStub = defineComponent({
  name: 'ButtonStub',
  props: {
    ariaLabel: {
      type: String,
      default: ''
    }
  },
  emits: ['click'],
  setup(props, { emit }) {
    return () => h('button', {
      'aria-label': props.ariaLabel,
      onClick: (event: MouseEvent) => emit('click', event)
    })
  }
})

const AlertStub = defineComponent({
  name: 'AlertStub',
  props: {
    title: {
      type: String,
      default: ''
    }
  },
  setup(props) {
    return () => h('div', { class: 'alert-stub' }, props.title)
  }
})

const openViewer = (input: { path: string, line?: number | null }) => {
  const { openViewer: openLocalFileViewer } = useLocalFileViewer()
  openLocalFileViewer({
    workspace: { kind: 'project', id: 'demo' },
    path: input.path,
    line: input.line ?? null
  })
}

const mountModal = () =>
  mount(LocalFileViewerModal, {
    global: {
      stubs: {
        UModal: ModalStub,
        UButton: ButtonStub,
        UAlert: AlertStub
      }
    }
  })

describe('LocalFileViewerModal', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    const { state } = useLocalFileViewer()
    state.value = {
      open: false,
      workspace: null,
      projectId: null,
      path: null,
      line: null,
      column: null
    }
    vi.stubGlobal('$fetch', fetchMock)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      setTimeout(() => callback(0), 0)
      return 1
    })
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('keeps text previews in the highlighted source viewer with target-line metadata', async () => {
    openViewer({
      path: '/Users/demo/Project/codori/src/viewer.ts',
      line: 2
    })
    fetchMock.mockResolvedValue({
      file: {
        kind: 'text',
        path: '/Users/demo/Project/codori/src/viewer.ts',
        relativePath: 'src/viewer.ts',
        name: 'viewer.ts',
        size: 35,
        updatedAt: Date.UTC(2026, 4, 9, 6, 0),
        text: 'const first = 1\nconst second = 2\n'
      }
    })

    const wrapper = mountModal()
    await flushPromises()
    await nextTick()
    await flushPromises()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    const requestedUrl = new URL(String(fetchMock.mock.calls[0]?.[0]), 'http://localhost')
    expect(requestedUrl.pathname).toBe('/api/projects/demo/local-file')
    expect(requestedUrl.searchParams.get('path')).toBe('/Users/demo/Project/codori/src/viewer.ts')
    expect(wrapper.find('.local-file-viewer-code').exists()).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.text()).toContain('src/viewer.ts')
    expect(wrapper.text()).toContain('3 lines')
    expect(wrapper.text()).toContain('TypeScript')
    expect(wrapper.text()).toContain('Line 2')
    expect(wrapper.get('[data-file-line="2"]').classes()).toContain('is-target-line')
  })

  it('renders image previews without the markdown source viewer metadata', async () => {
    openViewer({
      path: '/Users/demo/Project/codori/assets/pixel.png'
    })
    fetchMock.mockResolvedValue({
      file: {
        kind: 'image',
        path: '/Users/demo/Project/codori/assets/pixel.png',
        relativePath: 'assets/pixel.png',
        name: 'pixel.png',
        size: 68,
        updatedAt: Date.UTC(2026, 4, 9, 6, 0),
        mediaType: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ'
      }
    })

    const wrapper = mountModal()
    await flushPromises()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))

    const image = wrapper.get('img')
    expect(wrapper.find('.local-file-viewer-image').exists()).toBe(true)
    expect(wrapper.find('.local-file-viewer-code').exists()).toBe(false)
    expect(image.attributes('src')).toBe('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ')
    expect(image.attributes('alt')).toBe('pixel.png')
    expect(wrapper.text()).toContain('assets/pixel.png')
    expect(wrapper.text()).toContain('image/png')
    expect(wrapper.text()).not.toContain('lines')
    expect(wrapper.text()).not.toContain('Line')
  })
})

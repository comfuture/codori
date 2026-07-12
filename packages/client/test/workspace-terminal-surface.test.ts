/* eslint-disable vue/one-component-per-file */
// @vitest-environment jsdom

import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick, onBeforeUnmount, onMounted } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceTerminalSurface from '../app/components/WorkspaceTerminalSurface.vue'

type EmulatorSnapshot = {
  sessionId: string
  workspace: { kind: 'project' | 'chat', id: string }
  cwd: string
}

const mountedEmulators: EmulatorSnapshot[] = []
const unmountedEmulators: EmulatorSnapshot[] = []

const snapshotEmulator = (props: {
  sessionId: string
  workspace: { kind: 'project' | 'chat', id: string }
  cwd: string
}): EmulatorSnapshot => ({
  sessionId: props.sessionId,
  workspace: { ...props.workspace },
  cwd: props.cwd
})

const WorkspaceTerminalEmulatorStub = defineComponent({
  name: 'WorkspaceTerminalEmulatorStub',
  props: {
    sessionId: {
      type: String,
      required: true
    },
    workspace: {
      type: Object as () => { kind: 'project' | 'chat', id: string },
      required: true
    },
    cwd: {
      type: String,
      required: true
    },
    active: {
      type: Boolean,
      default: false
    }
  },
  setup(props) {
    const mountedSnapshot = snapshotEmulator(props)

    onMounted(() => {
      mountedEmulators.push(mountedSnapshot)
    })
    onBeforeUnmount(() => {
      unmountedEmulators.push(mountedSnapshot)
    })

    return () => h('div', {
      'data-terminal-emulator-stub': props.sessionId,
      'data-workspace-id': props.workspace.id,
      'data-cwd': props.cwd
    })
  }
})

const NuxtUiStub = defineComponent({
  name: 'NuxtUiStub',
  inheritAttrs: false,
  setup(_props, { attrs, slots }) {
    return () => h('div', attrs, slots.default?.())
  }
})

const matchMedia = vi.fn((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  dispatchEvent: vi.fn(() => true)
}))

const wrappers: VueWrapper[] = []

const mountSurface = () => {
  const wrapper = mount(WorkspaceTerminalSurface, {
    props: {
      open: true,
      workspace: { kind: 'project', id: 'workspace-one' },
      cwd: '/workspaces/one'
    },
    global: {
      stubs: {
        WorkspaceTerminalEmulator: WorkspaceTerminalEmulatorStub,
        UBadge: NuxtUiStub,
        UButton: NuxtUiStub,
        UIcon: NuxtUiStub,
        UTooltip: NuxtUiStub
      }
    }
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  mountedEmulators.length = 0
  unmountedEmulators.length = 0
  matchMedia.mockClear()
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia
  })
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) {
    wrapper.unmount()
  }
})

describe('WorkspaceTerminalSurface workspace identity', () => {
  it('replaces the emulator when the active workspace and cwd change', async () => {
    const wrapper = mountSurface()
    await nextTick()

    expect(mountedEmulators).toEqual([{
      sessionId: 'terminal-1-0',
      workspace: { kind: 'project', id: 'workspace-one' },
      cwd: '/workspaces/one'
    }])
    expect(unmountedEmulators).toEqual([])

    await wrapper.setProps({
      workspace: { kind: 'project', id: 'workspace-two' },
      cwd: '/workspaces/two'
    })
    await nextTick()

    expect(unmountedEmulators).toEqual([{
      sessionId: 'terminal-1-0',
      workspace: { kind: 'project', id: 'workspace-one' },
      cwd: '/workspaces/one'
    }])
    expect(mountedEmulators).toEqual([{
      sessionId: 'terminal-1-0',
      workspace: { kind: 'project', id: 'workspace-one' },
      cwd: '/workspaces/one'
    }, {
      sessionId: 'terminal-1-0',
      workspace: { kind: 'project', id: 'workspace-two' },
      cwd: '/workspaces/two'
    }])
  })
})

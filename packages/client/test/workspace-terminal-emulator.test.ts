// @vitest-environment jsdom

import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WorkspaceTerminalEmulator from '../app/components/WorkspaceTerminalEmulator.client.vue'
import {
  WORKSPACE_TERMINAL_MESLO_FONT_FAMILY,
  WORKSPACE_TERMINAL_SYSTEM_FONT_FAMILY
} from '../shared/workspace-terminal-font'

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

type TerminalRecord = {
  options: Record<string, unknown>
  open: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

type ProcessRecord = {
  start: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

const mocks = vi.hoisted(() => ({
  loadFonts: vi.fn(),
  terminals: [] as TerminalRecord[],
  processes: [] as ProcessRecord[],
  resizeObserverCount: 0,
  mutationObserverCount: 0,
  createWorkspaceClient: vi.fn(() => ({ id: 'terminal-client' }))
}))

vi.mock('@xterm/addon-web-fonts', () => ({
  loadFonts: mocks.loadFonts
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    readonly cols = 80

    readonly rows = 24

    readonly options: Record<string, unknown>

    readonly open = vi.fn()

    readonly focus = vi.fn()

    readonly loadAddon = vi.fn()

    readonly onData = vi.fn(() => ({ dispose: vi.fn() }))

    readonly onBinary = vi.fn(() => ({ dispose: vi.fn() }))

    readonly write = vi.fn()

    readonly writeln = vi.fn()

    readonly paste = vi.fn()

    readonly dispose = vi.fn()

    constructor(options: Record<string, unknown>) {
      this.options = { ...options }
      mocks.terminals.push(this)
    }
  }
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    readonly fit = vi.fn()
  }
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    constructor(handler: (event: MouseEvent, uri: string) => void) {
      void handler
    }
  }
}))

vi.mock('../app/composables/useRpc', () => ({
  useRpc: () => ({
    createWorkspaceClient: mocks.createWorkspaceClient
  })
}))

vi.mock('~~/shared/workspace-terminal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../shared/workspace-terminal')>()

  return {
    ...actual,
    WorkspaceTerminalProcess: class {
      readonly start = vi.fn().mockResolvedValue(undefined)

      readonly dispose = vi.fn().mockResolvedValue(undefined)

      readonly writeText = vi.fn()

      readonly writeBinary = vi.fn()

      readonly resize = vi.fn()

      constructor(options: unknown) {
        void options
        mocks.processes.push(this)
      }
    }
  }
})

class ResizeObserverStub {
  readonly observe = vi.fn()

  readonly disconnect = vi.fn()

  readonly unobserve = vi.fn()

  constructor(callback: ResizeObserverCallback) {
    void callback
    mocks.resizeObserverCount += 1
  }
}

class MutationObserverStub {
  readonly observe = vi.fn()

  readonly disconnect = vi.fn()

  readonly takeRecords = vi.fn(() => [])

  constructor(callback: MutationCallback) {
    void callback
    mocks.mutationObserverCount += 1
  }
}

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

const wrappers: VueWrapper[] = []

const mountEmulator = () => {
  const wrapper = mount(WorkspaceTerminalEmulator, {
    props: {
      sessionId: 'terminal-1',
      workspace: { kind: 'project', id: 'codori' },
      cwd: '/workspace/codori',
      active: true
    }
  })
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  mocks.loadFonts.mockReset()
  mocks.createWorkspaceClient.mockClear()
  mocks.terminals.length = 0
  mocks.processes.length = 0
  mocks.resizeObserverCount = 0
  mocks.mutationObserverCount = 0
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
  vi.stubGlobal('MutationObserver', MutationObserverStub)
})

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) {
    wrapper.unmount()
  }
  vi.unstubAllGlobals()
})

describe('WorkspaceTerminalEmulator font initialization', () => {
  it('awaits the web font before constructing or opening Xterm', async () => {
    const fontLoad = deferred<void>()
    mocks.loadFonts.mockReturnValue(fontLoad.promise)

    mountEmulator()
    await nextTick()

    expect(mocks.loadFonts).toHaveBeenCalledWith(['MesloLGS NF'])
    expect(mocks.terminals).toHaveLength(0)

    fontLoad.resolve()
    await vi.waitFor(() => expect(mocks.terminals).toHaveLength(1))

    expect(mocks.terminals[0]?.open).toHaveBeenCalledTimes(1)
  })

  it('uses Meslo when the bundled web font loads successfully', async () => {
    mocks.loadFonts.mockResolvedValue(undefined)

    mountEmulator()
    await vi.waitFor(() => expect(mocks.terminals).toHaveLength(1))

    expect(mocks.terminals[0]?.options.fontFamily).toBe(WORKSPACE_TERMINAL_MESLO_FONT_FAMILY)
    expect(mocks.terminals[0]?.open).toHaveBeenCalledTimes(1)
    expect(mocks.processes[0]?.start).toHaveBeenCalledWith({ cols: 80, rows: 24 })
  })

  it('uses the system monospace stack when web-font loading rejects', async () => {
    mocks.loadFonts.mockRejectedValue(new Error('font unavailable'))

    mountEmulator()
    await vi.waitFor(() => expect(mocks.terminals).toHaveLength(1))

    expect(mocks.terminals[0]?.options.fontFamily).toBe(WORKSPACE_TERMINAL_SYSTEM_FONT_FAMILY)
    expect(mocks.terminals[0]?.open).toHaveBeenCalledTimes(1)
    expect(mocks.processes[0]?.start).toHaveBeenCalledWith({ cols: 80, rows: 24 })
  })

  it('does not create terminal resources when unmounted during font loading', async () => {
    const fontLoad = deferred<void>()
    mocks.loadFonts.mockReturnValue(fontLoad.promise)
    const wrapper = mountEmulator()
    await nextTick()

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    fontLoad.resolve()
    await Promise.resolve()
    await nextTick()

    expect(mocks.terminals).toHaveLength(0)
    expect(mocks.processes).toHaveLength(0)
    expect(mocks.resizeObserverCount).toBe(0)
    expect(mocks.mutationObserverCount).toBe(0)
    expect(mocks.createWorkspaceClient).not.toHaveBeenCalled()
  })
})

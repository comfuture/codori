<script setup lang="ts">
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal, type ITheme } from '@xterm/xterm'
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRpc } from '../composables/useRpc'
import {
  createWorkspaceTerminalProcessId,
  requiresTerminalPasteConfirmation,
  resolveTerminalLink,
  WorkspaceTerminalProcess,
  type WorkspaceTerminalEvent,
  type WorkspaceTerminalShell
} from '~~/shared/workspace-terminal'
import { loadWorkspaceTerminalFontFamily } from '~~/shared/workspace-terminal-font'

const props = defineProps<{
  sessionId: string
  workspace: { kind: 'project' | 'chat', id: string }
  cwd: string
  active: boolean
}>()

const emit = defineEmits<{
  status: [event: WorkspaceTerminalEvent]
  shell: [shell: WorkspaceTerminalShell]
}>()

const host = ref<HTMLElement | null>(null)
const { createWorkspaceClient } = useRpc()

let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let process: WorkspaceTerminalProcess | null = null
let resizeObserver: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
let resizeTimer: ReturnType<typeof setTimeout> | null = null
let fitFrame: number | null = null
let removePasteListener: (() => void) | null = null
let isDisposed = false

const createTheme = (resolveColor: (value: string, fallback: string) => string): ITheme => ({
  background: resolveColor('var(--ui-bg)', 'rgb(10, 10, 10)'),
  foreground: resolveColor('var(--ui-text-highlighted)', 'rgb(245, 245, 245)'),
  cursor: resolveColor('var(--ui-primary)', 'rgb(34, 197, 94)'),
  cursorAccent: resolveColor('var(--ui-bg)', 'rgb(10, 10, 10)'),
  selectionBackground: resolveColor('color-mix(in srgb, var(--ui-primary) 28%, transparent)', 'rgba(34, 197, 94, 0.28)'),
  black: resolveColor('var(--ui-text-dimmed)', 'rgb(82, 82, 82)'),
  red: resolveColor('var(--ui-error)', 'rgb(239, 68, 68)'),
  green: resolveColor('var(--ui-success)', 'rgb(34, 197, 94)'),
  yellow: resolveColor('var(--ui-warning)', 'rgb(234, 179, 8)'),
  blue: resolveColor('var(--ui-info)', 'rgb(59, 130, 246)'),
  magenta: resolveColor('var(--ui-primary)', 'rgb(168, 85, 247)'),
  cyan: resolveColor('var(--ui-info)', 'rgb(6, 182, 212)'),
  white: resolveColor('var(--ui-text-highlighted)', 'rgb(245, 245, 245)'),
  brightBlack: resolveColor(
    'color-mix(in srgb, var(--ui-text-highlighted) 45%, transparent)',
    'rgba(245, 245, 245, 0.45)'
  ),
  brightRed: resolveColor('var(--ui-error)', 'rgb(248, 113, 113)'),
  brightGreen: resolveColor('var(--ui-success)', 'rgb(74, 222, 128)'),
  brightYellow: resolveColor('var(--ui-warning)', 'rgb(250, 204, 21)'),
  brightBlue: resolveColor('var(--ui-info)', 'rgb(96, 165, 250)'),
  brightMagenta: resolveColor('var(--ui-primary)', 'rgb(192, 132, 252)'),
  brightCyan: resolveColor('var(--ui-info)', 'rgb(34, 211, 238)'),
  brightWhite: resolveColor('var(--ui-text)', 'rgb(255, 255, 255)')
})

const resolveTheme = () => {
  const element = host.value
  if (!element) {
    return createTheme((_value, fallback) => fallback)
  }

  const probe = document.createElement('span')
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  element.append(probe)

  try {
    return createTheme((value, fallback) => {
      probe.style.color = value
      return getComputedStyle(probe).color || fallback
    })
  } finally {
    probe.remove()
  }
}

const scheduleFit = () => {
  if (!props.active || !host.value || !terminal || !fitAddon) {
    return
  }

  if (fitFrame !== null) {
    cancelAnimationFrame(fitFrame)
  }

  fitFrame = requestAnimationFrame(() => {
    fitFrame = null
    const bounds = host.value?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || !terminal || !fitAddon) {
      return
    }

    fitAddon.fit()
    if (resizeTimer !== null) {
      clearTimeout(resizeTimer)
    }
    resizeTimer = setTimeout(() => {
      resizeTimer = null
      if (terminal) {
        process?.resize({ cols: terminal.cols, rows: terminal.rows })
      }
    }, 100)
  })
}

const writeStatus = (event: WorkspaceTerminalEvent) => {
  emit('status', event)

  if (!terminal) {
    return
  }

  if (event.state === 'disconnected') {
    terminal.options.disableStdin = true
    terminal.writeln('\r\n\x1b[33mConnection lost. This terminal cannot be resumed; start a new session.\x1b[0m')
  } else if (event.state === 'output-limit') {
    terminal.options.disableStdin = true
    terminal.writeln('\r\n\x1b[33mOutput limit reached. The process was terminated.\x1b[0m')
  } else if (event.state === 'exited') {
    terminal.options.disableStdin = true
    terminal.writeln(`\r\n\x1b[2mProcess exited with code ${event.exitCode ?? 0}.\x1b[0m`)
  } else if (event.state === 'error') {
    terminal.options.disableStdin = true
    terminal.writeln(`\r\n\x1b[31m${event.error ?? 'Terminal failed.'}\x1b[0m`)
  }
}

onMounted(async () => {
  if (!host.value) {
    return
  }

  const fontFamily = await loadWorkspaceTerminalFontFamily()
  if (isDisposed || !host.value) {
    return
  }

  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily,
    fontSize: 13,
    lineHeight: 1.2,
    scrollback: 5000,
    screenReaderMode: true,
    theme: resolveTheme()
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon((event, uri) => {
    const safeUrl = resolveTerminalLink(event, uri)
    if (safeUrl) {
      window.open(safeUrl, '_blank', 'noopener,noreferrer')
    }
  }))
  terminal.open(host.value)
  terminal.focus()

  const client = createWorkspaceClient(props.workspace)
  process = new WorkspaceTerminalProcess({
    client,
    cwd: props.cwd,
    processId: createWorkspaceTerminalProcessId(props.sessionId),
    onOutput: bytes => terminal?.write(bytes),
    onEvent: writeStatus,
    onShell: shell => emit('shell', shell)
  })

  terminal.onData(value => process?.writeText(value))
  terminal.onBinary(value => process?.writeBinary(value))

  const handlePaste = (event: ClipboardEvent) => {
    const text = event.clipboardData?.getData('text')
    if (!text) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    if (
      requiresTerminalPasteConfirmation(text)
      && !window.confirm('Paste multi-line or large content into this terminal? It may execute commands.')
    ) {
      return
    }
    terminal?.paste(text)
  }
  host.value.addEventListener('paste', handlePaste, { capture: true })
  removePasteListener = () => host.value?.removeEventListener('paste', handlePaste, { capture: true })

  resizeObserver = new ResizeObserver(scheduleFit)
  resizeObserver.observe(host.value)
  themeObserver = new MutationObserver(() => {
    if (terminal) {
      terminal.options.theme = resolveTheme()
    }
  })
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class', 'style']
  })

  await nextTick()
  if (isDisposed || !terminal || !fitAddon || !process) {
    return
  }
  fitAddon.fit()
  await process.start({ cols: terminal.cols, rows: terminal.rows })
})

watch(() => props.active, async (active) => {
  if (!active) {
    return
  }

  await nextTick()
  scheduleFit()
  terminal?.focus()
})

onBeforeUnmount(() => {
  isDisposed = true
  removePasteListener?.()
  resizeObserver?.disconnect()
  themeObserver?.disconnect()
  if (resizeTimer !== null) {
    clearTimeout(resizeTimer)
  }
  if (fitFrame !== null) {
    cancelAnimationFrame(fitFrame)
  }
  void process?.dispose()
  terminal?.dispose()
  process = null
  terminal = null
  fitAddon = null
})
</script>

<template>
  <div
    ref="host"
    class="h-full min-h-0 w-full overflow-hidden px-2 py-2"
    role="application"
    aria-label="Interactive workspace terminal"
    data-codori-shortcuts="ignore"
  />
</template>

<style scoped>
:deep(.xterm) {
  height: 100%;
  padding: 0.25rem;
}

:deep(.xterm-viewport) {
  scrollbar-color: color-mix(in srgb, var(--ui-text-muted) 55%, transparent) transparent;
}
</style>

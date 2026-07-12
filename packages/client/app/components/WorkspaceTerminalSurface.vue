<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  TERMINAL_MAX_SESSIONS,
  canCreateWorkspaceTerminalSession,
  type WorkspaceTerminalEvent,
  type WorkspaceTerminalShell,
  type WorkspaceTerminalState
} from '~~/shared/workspace-terminal'

const props = defineProps<{
  open: boolean
  workspace: { kind: 'project' | 'chat', id: string }
  cwd: string
}>()

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

type TerminalSession = {
  id: string
  generation: number
  label: string
  state: WorkspaceTerminalState
  shell: string
  exitCode?: number
  error?: string
}

const sessions = ref<TerminalSession[]>([])
const activeSessionId = ref<string | null>(null)
const dockHeight = ref(320)
const isMobile = ref(false)
let nextSessionNumber = 1
let viewportQuery: MediaQueryList | null = null
let removeViewportListener: (() => void) | null = null
let removeDragListeners: (() => void) | null = null

const activeSession = computed(() =>
  sessions.value.find(session => session.id === activeSessionId.value) ?? null
)
const canCreateSession = computed(() => canCreateWorkspaceTerminalSession(sessions.value.length))
const canRestartSession = computed(() =>
  activeSession.value !== null
  && ['exited', 'disconnected', 'output-limit', 'error'].includes(activeSession.value.state)
)

const statusMeta = (state: WorkspaceTerminalState) => {
  switch (state) {
    case 'running':
      return { label: 'Running', color: 'success' as const }
    case 'starting':
      return { label: 'Starting', color: 'info' as const }
    case 'terminating':
      return { label: 'Stopping', color: 'warning' as const }
    case 'exited':
      return { label: 'Exited', color: 'neutral' as const }
    case 'disconnected':
      return { label: 'Disconnected', color: 'warning' as const }
    case 'output-limit':
      return { label: 'Output limit', color: 'warning' as const }
    default:
      return { label: 'Error', color: 'error' as const }
  }
}

const addSession = () => {
  if (!canCreateSession.value) {
    return
  }

  const number = nextSessionNumber
  nextSessionNumber += 1
  const session: TerminalSession = {
    id: `terminal-${number}`,
    generation: 0,
    label: `Terminal ${number}`,
    state: 'starting',
    shell: 'Detecting shell'
  }
  sessions.value.push(session)
  activeSessionId.value = session.id
}

const closeSession = (sessionId: string) => {
  const index = sessions.value.findIndex(session => session.id === sessionId)
  if (index < 0) {
    return
  }

  sessions.value.splice(index, 1)
  if (activeSessionId.value === sessionId) {
    activeSessionId.value = sessions.value[index]?.id ?? sessions.value[index - 1]?.id ?? null
  }
  if (sessions.value.length === 0) {
    emit('update:open', false)
  }
}

const restartActiveSession = () => {
  const session = activeSession.value
  if (!session || !canRestartSession.value) {
    return
  }

  session.generation += 1
  session.state = 'starting'
  session.exitCode = undefined
  session.error = undefined
  session.shell = 'Detecting shell'
}

const updateSessionStatus = (session: TerminalSession, event: WorkspaceTerminalEvent) => {
  session.state = event.state
  session.exitCode = event.exitCode
  session.error = event.error
}

const updateSessionShell = (session: TerminalSession, shell: WorkspaceTerminalShell) => {
  session.shell = shell.label
}

const hideSurface = () => emit('update:open', false)

const beginDockResize = (event: PointerEvent) => {
  if (isMobile.value) {
    return
  }

  event.preventDefault()
  const startY = event.clientY
  const startHeight = dockHeight.value
  const handleMove = (moveEvent: PointerEvent) => {
    const viewportLimit = Math.max(220, window.innerHeight * 0.65)
    dockHeight.value = Math.min(viewportLimit, Math.max(220, startHeight + startY - moveEvent.clientY))
  }
  const handleUp = () => {
    removeDragListeners?.()
    removeDragListeners = null
  }
  window.addEventListener('pointermove', handleMove)
  window.addEventListener('pointerup', handleUp, { once: true })
  removeDragListeners = () => {
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleUp)
  }
}

watch(() => props.open, (open) => {
  if (open && sessions.value.length === 0) {
    addSession()
  }
})

watch(() => `${props.workspace.kind}:${props.workspace.id}:${props.cwd}`, () => {
  sessions.value = []
  activeSessionId.value = null
  nextSessionNumber = 1
  if (props.open) {
    addSession()
  }
})

onMounted(() => {
  viewportQuery = window.matchMedia('(max-width: 767px)')
  isMobile.value = viewportQuery.matches
  const handleViewportChange = (event: MediaQueryListEvent) => {
    isMobile.value = event.matches
  }
  viewportQuery.addEventListener('change', handleViewportChange)
  removeViewportListener = () => viewportQuery?.removeEventListener('change', handleViewportChange)

  if (props.open && sessions.value.length === 0) {
    addSession()
  }
})

onBeforeUnmount(() => {
  removeViewportListener?.()
  removeDragListeners?.()
})
</script>

<template>
  <button
    v-if="open"
    type="button"
    class="fixed inset-0 z-40 bg-black/35 md:hidden"
    aria-label="Hide terminal"
    @click="hideSurface"
  />

  <section
    v-show="open"
    class="fixed inset-x-2 bottom-2 z-50 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-default bg-default shadow-2xl md:relative md:inset-auto md:z-auto md:w-full md:shrink-0 md:rounded-none md:border-x-0 md:border-b-0 md:shadow-none"
    :class="isMobile ? 'h-[min(78dvh,calc(var(--app-viewport-height)-1rem))]' : ''"
    :style="isMobile ? undefined : { height: `${dockHeight}px` }"
    :role="isMobile ? 'dialog' : 'region'"
    :aria-modal="isMobile ? 'true' : undefined"
    aria-label="Workspace terminal"
    data-workspace-terminal=""
  >
    <button
      type="button"
      class="hidden h-1.5 shrink-0 cursor-row-resize touch-none bg-elevated transition hover:bg-primary/30 md:block"
      aria-label="Resize terminal dock"
      @pointerdown="beginDockResize"
    />
    <div class="flex h-5 shrink-0 items-center justify-center md:hidden">
      <span class="h-1 w-10 rounded-full bg-muted" />
    </div>

    <header class="flex min-h-11 shrink-0 items-center gap-2 border-b border-default px-2 py-1.5">
      <div
        class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
        role="tablist"
        aria-label="Terminal sessions"
      >
        <div
          v-for="session in sessions"
          :key="session.id"
          class="flex shrink-0 items-center rounded-lg border"
          :class="session.id === activeSessionId ? 'border-primary/35 bg-primary/10' : 'border-transparent'"
        >
          <button
            type="button"
            role="tab"
            class="flex min-w-0 items-center gap-2 px-2 py-1.5 text-xs text-highlighted"
            :aria-selected="session.id === activeSessionId"
            @click="activeSessionId = session.id"
          >
            <UIcon
              name="i-lucide-square-terminal"
              class="size-3.5 shrink-0"
            />
            <span class="max-w-28 truncate">{{ session.label }}</span>
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="session.state === 'running' ? 'bg-success' : session.state === 'error' ? 'bg-error' : 'bg-warning'"
            />
          </button>
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-x"
            class="me-0.5 size-6 justify-center rounded-md px-0"
            :aria-label="`Close ${session.label} and terminate its process`"
            @click="closeSession(session.id)"
          />
        </div>
      </div>

      <UTooltip :text="`New terminal (${sessions.length}/${TERMINAL_MAX_SESSIONS})`">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-plus"
          :disabled="!canCreateSession"
          aria-label="New terminal session"
          @click="addSession"
        />
      </UTooltip>
      <UTooltip
        v-if="canRestartSession"
        text="Start a new process; disconnected terminals cannot resume"
      >
        <UButton
          type="button"
          color="warning"
          variant="soft"
          size="xs"
          icon="i-lucide-refresh-cw"
          aria-label="Start a new terminal process"
          @click="restartActiveSession"
        />
      </UTooltip>
      <UTooltip text="Hide terminal">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="xs"
          icon="i-lucide-panel-bottom-close"
          aria-label="Hide terminal"
          @click="hideSurface"
        />
      </UTooltip>
    </header>

    <div
      v-if="activeSession"
      class="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-default bg-elevated/25 px-3 py-1.5 text-[11px] text-muted"
      aria-live="polite"
    >
      <UBadge
        :color="statusMeta(activeSession.state).color"
        variant="soft"
        size="sm"
      >
        {{ statusMeta(activeSession.state).label }}
      </UBadge>
      <span class="truncate font-mono">{{ activeSession.shell }}</span>
      <span class="truncate font-mono">{{ cwd }}</span>
      <span class="font-medium text-primary">Workspace sandbox</span>
      <span v-if="activeSession.exitCode !== undefined">Exit {{ activeSession.exitCode }}</span>
      <span
        v-if="activeSession.error"
        class="truncate text-error"
      >{{ activeSession.error }}</span>
    </div>

    <div class="relative min-h-0 flex-1 bg-default">
      <WorkspaceTerminalEmulator
        v-for="session in sessions"
        v-show="session.id === activeSessionId"
        :key="`${session.id}:${session.generation}`"
        :session-id="`${session.id}-${session.generation}`"
        :workspace="workspace"
        :cwd="cwd"
        :active="session.id === activeSessionId && open"
        @status="updateSessionStatus(session, $event)"
        @shell="updateSessionShell(session, $event)"
      />
    </div>
  </section>
</template>

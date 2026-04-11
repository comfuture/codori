import type { SubagentAgentStatus, VisualSubagentPanel } from './codex-chat'

export type SubagentPanelAutoOpenInput = {
  isMobile: boolean
  hasAvailableSubagents: boolean
  hasResolvedState: boolean
  hasUserToggled: boolean
  previousActiveCount: number
  nextActiveCount: number
}

export type SubagentPanelAutoOpenResult = {
  hasResolvedState: boolean
  previousActiveCount: number
  nextOpen: boolean | null
}

const SUBAGENT_ACCENT_STYLES = [
  {
    textClass: 'text-emerald-700 dark:text-emerald-300',
    avatarClass: 'bg-emerald-500/15 text-emerald-700 ring-1 ring-inset ring-emerald-500/30 dark:text-emerald-300'
  },
  {
    textClass: 'text-sky-700 dark:text-sky-300',
    avatarClass: 'bg-sky-500/15 text-sky-700 ring-1 ring-inset ring-sky-500/30 dark:text-sky-300'
  },
  {
    textClass: 'text-amber-800 dark:text-amber-300',
    avatarClass: 'bg-amber-500/15 text-amber-800 ring-1 ring-inset ring-amber-500/35 dark:text-amber-300'
  },
  {
    textClass: 'text-rose-700 dark:text-rose-300',
    avatarClass: 'bg-rose-500/15 text-rose-700 ring-1 ring-inset ring-rose-500/30 dark:text-rose-300'
  },
  {
    textClass: 'text-violet-700 dark:text-violet-300',
    avatarClass: 'bg-violet-500/15 text-violet-700 ring-1 ring-inset ring-violet-500/30 dark:text-violet-300'
  },
  {
    textClass: 'text-cyan-700 dark:text-cyan-300',
    avatarClass: 'bg-cyan-500/15 text-cyan-700 ring-1 ring-inset ring-cyan-500/30 dark:text-cyan-300'
  },
  {
    textClass: 'text-lime-800 dark:text-lime-300',
    avatarClass: 'bg-lime-500/15 text-lime-800 ring-1 ring-inset ring-lime-500/35 dark:text-lime-300'
  },
  {
    textClass: 'text-orange-700 dark:text-orange-300',
    avatarClass: 'bg-orange-500/15 text-orange-700 ring-1 ring-inset ring-orange-500/30 dark:text-orange-300'
  }
] as const

export const resolveSubagentAccent = (index: number) =>
  SUBAGENT_ACCENT_STYLES[index % SUBAGENT_ACCENT_STYLES.length] ?? SUBAGENT_ACCENT_STYLES[0]!

export const toSubagentAvatarText = (name: string) => {
  const normalized = name.replace(/\s+/g, '').trim()
  return Array.from(normalized || 'AG').slice(0, 2).join('')
}

export const resolveSubagentStatusMeta = (status: SubagentAgentStatus) => {
  switch (status) {
    case 'pendingInit':
      return { color: 'primary', label: 'pending' }
    case 'running':
      return { color: 'info', label: 'running' }
    case 'completed':
      return { color: 'success', label: 'completed' }
    case 'interrupted':
      return { color: 'warning', label: 'interrupted' }
    case 'errored':
      return { color: 'error', label: 'errored' }
    case 'shutdown':
      return { color: 'neutral', label: 'shutdown' }
    case 'notFound':
      return { color: 'neutral', label: 'not found' }
    default:
      return { color: 'neutral', label: 'active' }
  }
}

export const resolveSubagentPanelAutoOpen = (
  input: SubagentPanelAutoOpenInput
): SubagentPanelAutoOpenResult => {
  if (!input.hasAvailableSubagents) {
    return {
      hasResolvedState: false,
      previousActiveCount: 0,
      nextOpen: false
    }
  }

  if (!input.hasResolvedState) {
    return {
      hasResolvedState: true,
      previousActiveCount: input.nextActiveCount,
      nextOpen: input.isMobile ? false : input.nextActiveCount > 0
    }
  }

  if (
    !input.isMobile
    && !input.hasUserToggled
    && input.previousActiveCount === 0
    && input.nextActiveCount > 0
  ) {
    return {
      hasResolvedState: true,
      previousActiveCount: input.nextActiveCount,
      nextOpen: true
    }
  }

  return {
    hasResolvedState: true,
    previousActiveCount: input.nextActiveCount,
    nextOpen: null
  }
}

export const resolveExpandedSubagentPanel = (
  panels: VisualSubagentPanel[],
  expandedThreadId: string | null
) => {
  if (!expandedThreadId) {
    return null
  }

  return panels.find(panel => panel.threadId === expandedThreadId) ?? null
}

export const pruneExpandedSubagentThreadId = (
  panels: VisualSubagentPanel[],
  expandedThreadId: string | null
) => resolveExpandedSubagentPanel(panels, expandedThreadId)?.threadId ?? null

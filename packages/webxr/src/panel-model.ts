import {
  FOREGROUND_PANEL_DWELL_MS,
  MAX_PANEL_OUTPUT_CHARS,
  PANEL_ANIMATION_MS
} from './config'

export type SpatialPanelKind =
  | 'command'
  | 'file-change'
  | 'mcp-tool'
  | 'dynamic-tool'
  | 'web-search'
  | 'background-terminal'

export type SpatialPanelStatus =
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'declined'
  | 'requires-action'

export type SpatialPanelPhase =
  | 'appearing'
  | 'visible'
  | 'dwelling'
  | 'disappearing'

export type SpatialPanelInput = {
  id: string
  kind: SpatialPanelKind
  title: string
  status: SpatialPanelStatus
  text: string
  cwd?: string | null
  exitCode?: number | null
  background: boolean
}

export type SpatialPanelSnapshot = SpatialPanelInput & {
  retainedText: string
  truncated: boolean
  phase: SpatialPanelPhase
  phaseStartedAt: number
  scrollOffset: number
  autoFollow: boolean
  userMoved: boolean
  slot: number | null
}

const isTerminalStatus = (status: SpatialPanelStatus) =>
  status === 'completed'
  || status === 'failed'
  || status === 'declined'

export const retainBoundedOutput = (
  text: string,
  maximumCharacters = MAX_PANEL_OUTPUT_CHARS
) => {
  const limit = Math.max(1, Math.floor(maximumCharacters))
  if (text.length <= limit) {
    return {
      text,
      truncated: false
    }
  }

  const longMarker = '[… earlier output truncated for headset memory …]\n'
  const marker = longMarker.length < limit
    ? longMarker
    : '[…]\n'.slice(0, limit)
  const retainedCharacters = Math.max(0, limit - marker.length)
  return {
    text: marker + (
      retainedCharacters > 0
        ? text.slice(-retainedCharacters)
        : ''
    ),
    truncated: true
  }
}

export class SpatialPanelModel {
  private panels = new Map<string, SpatialPanelSnapshot>()

  private readonly retiredForeground = new Set<string>()

  upsert(input: SpatialPanelInput, now: number) {
    const terminal = isTerminalStatus(input.status)
    if (!input.background && terminal && this.retiredForeground.has(input.id)) {
      return null
    }
    if (input.background || !terminal) {
      this.retiredForeground.delete(input.id)
    }
    const retained = retainBoundedOutput(input.text)
    const existing = this.panels.get(input.id)
    if (!existing) {
      const panel: SpatialPanelSnapshot = {
        ...input,
        retainedText: retained.text,
        truncated: retained.truncated,
        phase: 'appearing',
        phaseStartedAt: now,
        scrollOffset: Number.POSITIVE_INFINITY,
        autoFollow: true,
        userMoved: false,
        slot: null
      }
      this.panels.set(input.id, panel)
      return { ...panel }
    }

    const nextTerminal = isTerminalStatus(input.status)
    const wasTerminal = isTerminalStatus(existing.status)
    const phase = !input.background && nextTerminal && !wasTerminal
      ? 'dwelling'
      : existing.phase === 'disappearing' && !nextTerminal
        ? 'appearing'
        : existing.phase
    const phaseStartedAt = phase === existing.phase
      ? existing.phaseStartedAt
      : now
    const panel: SpatialPanelSnapshot = {
      ...existing,
      ...input,
      retainedText: retained.text,
      truncated: retained.truncated,
      phase,
      phaseStartedAt,
      scrollOffset: existing.autoFollow
        ? Number.POSITIVE_INFINITY
        : existing.scrollOffset
    }
    this.panels.set(input.id, panel)
    return { ...panel }
  }

  reconcileBackground(
    inputs: readonly SpatialPanelInput[],
    now: number
  ) {
    const authoritativeIds = new Set(
      inputs.filter(input => input.background).map(input => input.id)
    )
    for (const input of inputs) {
      this.upsert(input, now)
    }
    for (const panel of this.panels.values()) {
      if (
        panel.background
        && !authoritativeIds.has(panel.id)
        && panel.phase !== 'disappearing'
      ) {
        this.panels.set(panel.id, {
          ...panel,
          phase: 'disappearing',
          phaseStartedAt: now
        })
      }
    }
  }

  reconcileForeground(
    inputs: readonly SpatialPanelInput[],
    now: number
  ) {
    const authoritativeIds = new Set(
      inputs.filter(input => !input.background).map(input => input.id)
    )
    for (const input of inputs) {
      this.upsert(input, now)
    }
    for (const panel of this.panels.values()) {
      if (
        !panel.background
        && !authoritativeIds.has(panel.id)
        && panel.phase !== 'disappearing'
      ) {
        this.panels.set(panel.id, {
          ...panel,
          phase: 'disappearing',
          phaseStartedAt: now
        })
      }
    }
  }

  markInteraction(id: string, input: {
    scrollOffset?: number
    returnToLiveTail?: boolean
    userMoved?: boolean
  }) {
    const panel = this.panels.get(id)
    if (!panel) {
      return
    }
    const autoFollow = input.returnToLiveTail
      ? true
      : input.scrollOffset == null
        ? panel.autoFollow
        : false
    this.panels.set(id, {
      ...panel,
      autoFollow,
      scrollOffset: autoFollow
        ? Number.POSITIVE_INFINITY
        : input.scrollOffset ?? panel.scrollOffset,
      userMoved: input.userMoved ?? panel.userMoved
    })
  }

  scroll(id: string, deltaLines: number) {
    const panel = this.panels.get(id)
    if (!panel || !Number.isFinite(deltaLines) || deltaLines === 0) {
      return
    }
    const liveTail = Math.max(
      0,
      panel.retainedText.split('\n').length - 1
    )
    if (panel.autoFollow && deltaLines > 0) {
      return
    }
    const current = panel.autoFollow || !Number.isFinite(panel.scrollOffset)
      ? liveTail
      : panel.scrollOffset
    const next = Math.max(0, current + deltaLines)
    this.markInteraction(id, next >= liveTail
      ? { returnToLiveTail: true }
      : { scrollOffset: next })
  }

  assignSlot(id: string, slot: number) {
    const panel = this.panels.get(id)
    if (panel) {
      this.panels.set(id, { ...panel, slot })
    }
  }

  advance(now: number) {
    for (const [id, panel] of this.panels.entries()) {
      const age = now - panel.phaseStartedAt
      if (panel.phase === 'appearing' && age >= PANEL_ANIMATION_MS) {
        this.panels.set(id, {
          ...panel,
          phase: !panel.background && isTerminalStatus(panel.status)
            ? 'dwelling'
            : 'visible',
          phaseStartedAt: now
        })
        continue
      }
      if (
        panel.phase === 'dwelling'
        && age >= FOREGROUND_PANEL_DWELL_MS
      ) {
        this.panels.set(id, {
          ...panel,
          phase: 'disappearing',
          phaseStartedAt: now
        })
        continue
      }
      if (panel.phase === 'disappearing' && age >= PANEL_ANIMATION_MS) {
        if (!panel.background && isTerminalStatus(panel.status)) {
          this.retiredForeground.add(id)
        }
        this.panels.delete(id)
      }
    }
  }

  snapshots() {
    return [...this.panels.values()].map(panel => ({ ...panel }))
  }

  clear() {
    this.panels.clear()
    this.retiredForeground.clear()
  }
}

import type {
  ContextWindowState,
  TokenUsageSnapshot
} from '@codori/client/shared/chat-prompt-controls'
import {
  resolveContextWindowState,
  shouldShowContextWindowIndicator
} from '@codori/client/shared/chat-prompt-controls'
import {
  formatRateLimitWindowDuration,
  type RateLimitBucket
} from '@codori/client/shared/account-rate-limits'

export type StatusActionId =
  | 'passthrough'
  | 'recenter'
  | 'voice'
  | 'reduced-effects'
  | 'exit'

export type StatusActionInputPolicy = 'controller-or-touch' | 'any'

export type StatusAction = {
  id: StatusActionId
  label: string
  state: string | null
  available: boolean
  disabledReason: string | null
  inputPolicy: StatusActionInputPolicy
}

export type StatusWindowSnapshot = {
  rateLimits: RateLimitBucket[]
  context: ContextWindowState
  connection: string
  voice: string
  activePaneCount: number
  threadLabel: string | null
  workspaceLabel: string | null
  sessionLabel: string
  actions: StatusAction[]
}

export type StatusQuotaRow = {
  id: string
  label: string
  remainingPercent: number | null
  resetsAt: string | null
}

export const createStatusQuotaRows = (
  buckets: readonly RateLimitBucket[]
): StatusQuotaRow[] => buckets.flatMap(bucket => ([
  bucket.primary
    ? {
        id: `${bucket.limitId}:primary`,
        label: formatRateLimitWindowDuration(bucket.primary.windowDurationMins)
          ? `${bucket.limitName ?? bucket.limitId} · ${formatRateLimitWindowDuration(bucket.primary.windowDurationMins)}`
          : `${bucket.limitName ?? bucket.limitId} · primary`,
        remainingPercent: bucket.primary.usedPercent == null
          ? null
          : Math.max(0, 100 - bucket.primary.usedPercent),
        resetsAt: bucket.primary.resetsAt
      }
    : null,
  bucket.secondary
    ? {
        id: `${bucket.limitId}:secondary`,
        label: formatRateLimitWindowDuration(bucket.secondary.windowDurationMins)
          ? `${bucket.limitName ?? bucket.limitId} · ${formatRateLimitWindowDuration(bucket.secondary.windowDurationMins)}`
          : `${bucket.limitName ?? bucket.limitId} · secondary`,
        remainingPercent: bucket.secondary.usedPercent == null
          ? null
          : Math.max(0, 100 - bucket.secondary.usedPercent),
        resetsAt: bucket.secondary.resetsAt
      }
    : null
])).filter((row): row is StatusQuotaRow => row !== null)

export const createStatusActionRowLayout = (
  count: number,
  top = 570,
  height = 310
) => Array.from({ length: Math.max(0, count) }, (_, index) => ({
  index,
  top: top + ((height / count) * index),
  height: height / count
}))

export const shouldShowNoInputMenu = (input: {
  controller: boolean
  hand: boolean
}) => !input.controller && !input.hand

export const resolveStatusWindowScale = (
  phase: 'opening' | 'open' | 'closing' | 'closed',
  progress: number
) => {
  const value = Math.min(1, Math.max(0, progress))
  if (phase === 'opening') {
    return { x: 0.72 + value * 0.28, y: value }
  }
  if (phase === 'closing') {
    const remaining = 1 - value
    return { x: 0.5 + remaining * 0.5, y: remaining }
  }
  return phase === 'open'
    ? { x: 1, y: 1 }
    : { x: 0.5, y: 0 }
}

export const createUnknownContextState = () =>
  resolveContextWindowState(null, null)

export const resolveStatusContext = (
  tokenUsage: TokenUsageSnapshot | null,
  fallbackContextWindow: number | null = null
) => {
  const state = resolveContextWindowState(tokenUsage, fallbackContextWindow)
  return {
    ...state,
    available: shouldShowContextWindowIndicator(state)
  }
}

export type StatusActionState = {
  passthroughSupported: boolean
  passthroughActive: boolean
  passthroughDisabledReason?: string | null
  voiceState: 'inactive' | 'active' | 'resume-audio' | 'unavailable'
  reducedEffects: boolean
}

export const createStatusActions = (
  state: StatusActionState
): StatusAction[] => [{
  id: 'passthrough',
  label: 'Passthrough',
  state: state.passthroughActive ? 'On' : 'Off',
  available: state.passthroughSupported,
  disabledReason: state.passthroughSupported
    ? null
    : state.passthroughDisabledReason
      ?? 'Immersive AR is not available on this device.',
  inputPolicy: 'controller-or-touch'
}, {
  id: 'recenter',
  label: 'Recenter workspace',
  state: null,
  available: true,
  disabledReason: null,
  inputPolicy: 'controller-or-touch'
}, {
  id: 'voice',
  label: state.voiceState === 'resume-audio'
    ? 'Resume audio'
    : state.voiceState === 'active'
      ? 'Stop voice'
      : 'Start voice',
  state: state.voiceState === 'active' ? 'On' : 'Off',
  available: state.voiceState !== 'unavailable',
  disabledReason: state.voiceState === 'unavailable'
    ? 'Realtime voice is unavailable.'
    : null,
  inputPolicy: 'controller-or-touch'
}, {
  id: 'reduced-effects',
  label: 'Reduced effects',
  state: state.reducedEffects ? 'On' : 'Off',
  available: true,
  disabledReason: null,
  inputPolicy: 'controller-or-touch'
}, {
  id: 'exit',
  label: 'Exit immersive',
  state: null,
  available: true,
  disabledReason: null,
  inputPolicy: 'any'
}]

export type StatusActivation = {
  source: 'controller' | 'hand' | 'screen' | 'gaze'
  method: 'ray' | 'contact' | 'pinch'
}

export const canActivateStatusAction = (
  activation: StatusActivation,
  policy: StatusActionInputPolicy = 'any'
) => {
  if (
    policy === 'controller-or-touch'
    && (activation.source === 'screen' || activation.source === 'gaze')
  ) {
    return false
  }
  return activation.source === 'hand'
    ? activation.method === 'contact'
    : activation.method !== 'pinch'
}

export const mappedMenuButtonIndex = (
  handedness: XRHandedness,
  profiles: readonly string[]
) => handedness === 'left' && profiles.includes('htc-vive-focus') ? 4 : null

export type StatusGestureSample = {
  now: number
  tracked: boolean
  controllerActive: boolean
  wristHeightFromEyes: number
  handBackFacingViewer: number
}

export type StatusWindowInvocation = 'controller' | 'hand' | 'fallback'

export const STATUS_GESTURE_THRESHOLDS = {
  openHeightMeters: -0.28,
  closeHeightMeters: -0.48,
  openFacingDot: 0.55,
  closeFacingDot: 0.25,
  holdMs: 450,
  lowerHoldMs: 180,
  cooldownMs: 650
} as const

export class StatusGestureModel {
  private candidateSince: number | null = null
  private lowerSince: number | null = null
  private cooldownUntil = 0

  private trackingLostSince: number | null = null

  suppress(now: number) {
    this.candidateSince = null
    this.cooldownUntil = now + STATUS_GESTURE_THRESHOLDS.cooldownMs
  }

  update(
    sample: StatusGestureSample,
    state: { open: boolean, invocation: StatusWindowInvocation | null }
  ) {
    if (sample.controllerActive) {
      this.candidateSince = null
      this.lowerSince = null
      this.trackingLostSince = null
      return null
    }
    if (state.open && state.invocation !== 'hand') {
      this.candidateSince = null
      this.lowerSince = null
      this.trackingLostSince = null
      return null
    }
    if (!sample.tracked) {
      this.candidateSince = null
      this.lowerSince = null
      if (!state.open || state.invocation !== 'hand') {
        this.trackingLostSince = null
        return null
      }
      this.trackingLostSince ??= sample.now
      return sample.now - this.trackingLostSince >= 300
        ? 'close' as const
        : null
    }
    this.trackingLostSince = null
    if (state.open) {
      const lowered = sample.wristHeightFromEyes
        <= STATUS_GESTURE_THRESHOLDS.closeHeightMeters
        || sample.handBackFacingViewer
        <= STATUS_GESTURE_THRESHOLDS.closeFacingDot
      if (!lowered) {
        this.lowerSince = null
        return null
      }
      this.lowerSince ??= sample.now
      if (sample.now - this.lowerSince >= STATUS_GESTURE_THRESHOLDS.lowerHoldMs) {
        this.lowerSince = null
        this.cooldownUntil = sample.now + STATUS_GESTURE_THRESHOLDS.cooldownMs
        return 'close' as const
      }
      return null
    }
    const posed = sample.wristHeightFromEyes
      >= STATUS_GESTURE_THRESHOLDS.openHeightMeters
      && sample.handBackFacingViewer
      >= STATUS_GESTURE_THRESHOLDS.openFacingDot
    if (!posed || sample.now < this.cooldownUntil) {
      this.candidateSince = null
      return null
    }
    this.candidateSince ??= sample.now
    if (sample.now - this.candidateSince >= STATUS_GESTURE_THRESHOLDS.holdMs) {
      this.candidateSince = null
      return 'open' as const
    }
    return null
  }
}

export class StatusControllerArmModel {
  private lowerSince: number | null = null
  private trackingLostSince: number | null = null

  update(input: {
    now: number
    tracked: boolean
    gripHeightFromEyes: number
    open: boolean
    invocation: StatusWindowInvocation | null
  }) {
    if (!input.open || input.invocation !== 'controller') {
      this.lowerSince = null
      this.trackingLostSince = null
      return null
    }
    if (!input.tracked) {
      this.lowerSince = null
      this.trackingLostSince ??= input.now
      return input.now - this.trackingLostSince >= 300
        ? 'close' as const
        : null
    }
    this.trackingLostSince = null
    if (input.gripHeightFromEyes > -0.4) {
      this.lowerSince = null
      return null
    }
    if (input.gripHeightFromEyes > -0.55) {
      return null
    }
    this.lowerSince ??= input.now
    if (input.now - this.lowerSince >= 250) {
      this.lowerSince = null
      return 'close' as const
    }
    return null
  }
}

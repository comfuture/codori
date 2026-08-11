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
  presentation: 'toggle' | 'button'
  checked: boolean | null
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

export const shouldShowStatusFallbackMenu = (input: {
  mappedMenuController: boolean
  trackedLeftHand: boolean
  leftControllerActive: boolean
}) => !input.mappedMenuController && !(
  input.trackedLeftHand && !input.leftControllerActive
)

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
  presentation: 'toggle',
  checked: state.passthroughActive,
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
  presentation: 'button',
  checked: null,
  available: true,
  disabledReason: null,
  inputPolicy: 'controller-or-touch'
}, {
  id: 'voice',
  label: state.voiceState === 'resume-audio' ? 'Resume audio' : 'Voice',
  state: state.voiceState === 'resume-audio'
    ? null
    : state.voiceState === 'active' ? 'On' : 'Off',
  presentation: state.voiceState === 'resume-audio' ? 'button' : 'toggle',
  checked: state.voiceState === 'resume-audio'
    ? null
    : state.voiceState === 'active',
  available: state.voiceState !== 'unavailable',
  disabledReason: state.voiceState === 'unavailable'
    ? 'Realtime voice is unavailable.'
    : null,
  inputPolicy: 'controller-or-touch'
}, {
  id: 'reduced-effects',
  label: 'Reduced effects',
  state: state.reducedEffects ? 'On' : 'Off',
  presentation: 'toggle',
  checked: state.reducedEffects,
  available: true,
  disabledReason: null,
  inputPolicy: 'controller-or-touch'
}, {
  id: 'exit',
  label: 'Exit immersive',
  state: null,
  presentation: 'button',
  checked: null,
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
  gazeAtHandDot: number
  rightHandEngaged?: boolean
}

export type StatusWindowInvocation = 'controller' | 'hand' | 'fallback'

export type StatusWindowPhase = 'closed' | 'opening' | 'open' | 'closing'

export type StatusActionInteractionPhase =
  | 'closed'
  | 'emerging'
  | 'arming'
  | 'armed'

export const STATUS_ACTION_ARMING_GRACE_MS = 180

type StatusActionSourceState = {
  pressActive: boolean
  pressNeutral: boolean
  contactAction: StatusActionId | null
  contactNeutral: boolean
}

const createStatusActionSourceState = (): StatusActionSourceState => ({
  pressActive: false,
  pressNeutral: false,
  contactAction: null,
  contactNeutral: false
})

/**
 * Keeps status-window presentation separate from activation. The gate does not
 * arm until the opening animation and an additional grace period have both
 * completed. At that boundary it snapshots every observed press/contact so an
 * input that was already held or overlapping cannot become a fresh action.
 */
export class StatusActionInteractionModel {
  private currentPhase: StatusActionInteractionPhase = 'closed'

  private armAt: number | null = null

  private readonly sources = new Map<string, StatusActionSourceState>()

  get phase() {
    return this.currentPhase
  }

  private source(sourceId: string) {
    let source = this.sources.get(sourceId)
    if (!source) {
      source = createStatusActionSourceState()
      this.sources.set(sourceId, source)
    }
    return source
  }

  private close() {
    this.currentPhase = 'closed'
    this.armAt = null
    this.sources.clear()
  }

  updateWindow(input: {
    now: number
    open: boolean
    fullyOpen: boolean
  }) {
    if (!input.open) {
      this.close()
      return
    }
    if (this.currentPhase === 'closed') {
      this.currentPhase = 'emerging'
    }
    if (!input.fullyOpen) {
      this.currentPhase = 'emerging'
      this.armAt = null
      return
    }
    if (this.currentPhase === 'emerging') {
      this.currentPhase = 'arming'
      this.armAt = input.now + STATUS_ACTION_ARMING_GRACE_MS
    }
  }

  finishFrame(now: number) {
    if (
      this.currentPhase !== 'arming'
      || this.armAt == null
      || now < this.armAt
    ) {
      return
    }
    this.currentPhase = 'armed'
    for (const source of this.sources.values()) {
      source.pressNeutral = !source.pressActive
      source.contactNeutral = source.contactAction === null
    }
  }

  updatePress(sourceId: string, pressed: boolean) {
    const source = this.source(sourceId)
    const freshPress = pressed && !source.pressActive
    source.pressActive = pressed
    if (this.currentPhase !== 'armed') {
      return false
    }
    if (!pressed) {
      source.pressNeutral = true
      return false
    }
    if (!freshPress || !source.pressNeutral) {
      return false
    }
    source.pressNeutral = false
    return true
  }

  updateContact(sourceId: string, action: StatusActionId | null) {
    const source = this.source(sourceId)
    const freshContact = action !== null && source.contactAction === null
    source.contactAction = action
    if (this.currentPhase !== 'armed') {
      return null
    }
    if (action === null) {
      source.contactNeutral = true
      return null
    }
    if (!freshContact || !source.contactNeutral) {
      return null
    }
    source.contactNeutral = false
    return action
  }

  loseSource(sourceId: string) {
    this.sources.delete(sourceId)
  }
}

export const STATUS_GESTURE_THRESHOLDS = {
  openHeightMeters: -0.2,
  openFacingDot: 0.68,
  openGazeDot: 0.86,
  closeFacingDot: -0.3,
  closeFacingResetDot: 0.05,
  lowerTravelMeters: 0.18,
  lowerEndHeightMeters: -0.36,
  maximumPoseJumpMeters: 0.08,
  maximumWristSpeedMetersPerSecond: 1.6,
  holdMs: 700,
  turnAwayHoldMs: 560,
  lowerHoldMs: 320,
  trackingRecoveryMs: 180,
  selectionProtectionMs: 700,
  cooldownMs: 750
} as const

export class StatusGestureModel {
  private candidateSince: number | null = null

  private turnAwaySince: number | null = null

  private lowerSince: number | null = null

  private openReferenceHeight: number | null = null

  private lastTrackedHeight: number | null = null

  private lastTrackedAt: number | null = null

  private trackingStableSince: number | null = null

  private selectionProtectedUntil = 0

  private wasOpen = false

  private cooldownUntil = 0

  suppress(now: number) {
    this.candidateSince = null
    this.resetDismissalIntent()
    this.cooldownUntil = now + STATUS_GESTURE_THRESHOLDS.cooldownMs
  }

  private resetDismissalIntent() {
    this.turnAwaySince = null
    this.lowerSince = null
  }

  private resetTrackingContinuity() {
    this.resetDismissalIntent()
    this.lastTrackedHeight = null
    this.lastTrackedAt = null
    this.trackingStableSince = null
  }

  update(
    sample: StatusGestureSample,
    state: { open: boolean, invocation: StatusWindowInvocation | null }
  ) {
    if (sample.controllerActive) {
      this.candidateSince = null
      this.resetDismissalIntent()
      return null
    }
    if (state.open && state.invocation !== 'hand') {
      this.candidateSince = null
      this.resetDismissalIntent()
      return null
    }
    if (!sample.tracked) {
      this.candidateSince = null
      this.resetTrackingContinuity()
      return null
    }
    if (state.open) {
      if (!this.wasOpen) {
        this.openReferenceHeight = sample.wristHeightFromEyes
        this.resetTrackingContinuity()
      }
      this.wasOpen = true
      this.candidateSince = null

      const previousHeight = this.lastTrackedHeight
      const previousTrackedAt = this.lastTrackedAt
      this.lastTrackedHeight = sample.wristHeightFromEyes
      this.lastTrackedAt = sample.now
      const trackingIntervalSeconds = previousTrackedAt === null
        ? 0
        : Math.max(0, sample.now - previousTrackedAt) / 1_000
      const maximumContinuousMovement = (
        STATUS_GESTURE_THRESHOLDS.maximumPoseJumpMeters
        + trackingIntervalSeconds
          * STATUS_GESTURE_THRESHOLDS.maximumWristSpeedMetersPerSecond
      )
      if (
        previousHeight !== null
        && Math.abs(sample.wristHeightFromEyes - previousHeight)
        > maximumContinuousMovement
      ) {
        // A large single-frame wrist jump is characteristic of hand
        // occlusion/reacquisition, not a deliberate lowering trajectory.
        this.openReferenceHeight = null
        this.resetDismissalIntent()
        this.trackingStableSince = sample.now
        return null
      }

      this.trackingStableSince ??= sample.now
      this.openReferenceHeight = Math.max(
        this.openReferenceHeight ?? sample.wristHeightFromEyes,
        sample.wristHeightFromEyes
      )

      if (sample.rightHandEngaged) {
        this.selectionProtectedUntil = sample.now
          + STATUS_GESTURE_THRESHOLDS.selectionProtectionMs
        this.openReferenceHeight = sample.wristHeightFromEyes
        this.resetDismissalIntent()
        return null
      }
      if (
        sample.now < this.selectionProtectedUntil
        || sample.now - this.trackingStableSince
        < STATUS_GESTURE_THRESHOLDS.trackingRecoveryMs
      ) {
        this.openReferenceHeight = sample.wristHeightFromEyes
        this.resetDismissalIntent()
        return null
      }

      if (
        sample.handBackFacingViewer
        <= STATUS_GESTURE_THRESHOLDS.closeFacingDot
      ) {
        this.turnAwaySince ??= sample.now
      } else if (
        sample.handBackFacingViewer
        >= STATUS_GESTURE_THRESHOLDS.closeFacingResetDot
      ) {
        this.turnAwaySince = null
      }

      const lowered = (
        (this.openReferenceHeight - sample.wristHeightFromEyes)
          >= STATUS_GESTURE_THRESHOLDS.lowerTravelMeters
        && sample.wristHeightFromEyes
          <= STATUS_GESTURE_THRESHOLDS.lowerEndHeightMeters
      )
      if (lowered) {
        this.lowerSince ??= sample.now
      } else {
        this.lowerSince = null
      }

      const turnedAwayLongEnough = this.turnAwaySince !== null
        && sample.now - this.turnAwaySince
          >= STATUS_GESTURE_THRESHOLDS.turnAwayHoldMs
      const loweredLongEnough = this.lowerSince !== null
        && sample.now - this.lowerSince
          >= STATUS_GESTURE_THRESHOLDS.lowerHoldMs
      if (turnedAwayLongEnough || loweredLongEnough) {
        this.resetDismissalIntent()
        this.cooldownUntil = sample.now + STATUS_GESTURE_THRESHOLDS.cooldownMs
        return 'close' as const
      }
      return null
    }
    this.wasOpen = false
    this.openReferenceHeight = null
    this.resetTrackingContinuity()
    const posed = sample.wristHeightFromEyes
      >= STATUS_GESTURE_THRESHOLDS.openHeightMeters
      && sample.handBackFacingViewer
      >= STATUS_GESTURE_THRESHOLDS.openFacingDot
      && sample.gazeAtHandDot >= STATUS_GESTURE_THRESHOLDS.openGazeDot
    if (!posed || sample.now < this.cooldownUntil) {
      this.candidateSince = null
      return null
    }
    this.candidateSince ??= sample.now
    if (sample.now - this.candidateSince >= STATUS_GESTURE_THRESHOLDS.holdMs) {
      this.candidateSince = null
      this.openReferenceHeight = sample.wristHeightFromEyes
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

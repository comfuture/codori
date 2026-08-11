import { describe, expect, it } from 'vitest'
import {
  mergeAccountRateLimits,
  normalizeAccountRateLimits
} from '@codori/client/shared/account-rate-limits'
import {
  canActivateStatusAction,
  createStatusActions,
  createStatusActionRowLayout,
  createStatusQuotaRows,
  mappedMenuButtonIndex,
  resolveStatusContext,
  resolveStatusWindowScale,
  shouldShowStatusFallbackMenu,
  StatusActionInteractionModel,
  StatusControllerArmModel,
  StatusGestureModel
} from '../src/status-window-model'

describe('XR status window model', () => {
  it('merges a singular sparse rate-limit update without losing other buckets or fields', () => {
    const initial = normalizeAccountRateLimits({
      rateLimits: {
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          usedPercent: 20,
          resetsAt: '2026-08-11T12:00:00Z',
          windowDurationMins: 300
        },
        secondary: null
      },
      rateLimitsByLimitId: {
        review: {
          limitId: 'review',
          limitName: 'Review',
          primary: { usedPercent: 40 },
          secondary: null
        }
      }
    })

    expect(mergeAccountRateLimits(initial, {
      rateLimits: {
        limitId: 'codex',
        limitName: null,
        primary: { usedPercent: 35 },
        secondary: null
      }
    })).toEqual([
      expect.objectContaining({
        limitId: 'codex',
        limitName: 'Codex',
        primary: {
          usedPercent: 35,
          resetsAt: '2026-08-11T12:00:00Z',
          windowDurationMins: 300
        }
      }),
      expect.objectContaining({ limitId: 'review' })
    ])
  })

  it('keeps context unavailable until both occupancy and window are known', () => {
    expect(resolveStatusContext(null)).toMatchObject({
      available: false,
      remainingPercent: null
    })
    expect(resolveStatusContext({
      totalTokens: 10,
      totalInputTokens: 5,
      totalCachedInputTokens: 0,
      totalOutputTokens: 5,
      lastUsageKnown: true,
      lastTotalTokens: 2_000,
      lastInputTokens: 1_500,
      lastCachedInputTokens: 0,
      lastOutputTokens: 500,
      modelContextWindow: 10_000
    })).toMatchObject({
      available: true,
      remainingPercent: 80,
      remainingTokens: 8_000
    })
  })

  it('keeps both authoritative quota windows and their unknown states', () => {
    expect(createStatusQuotaRows([{
      limitId: 'codex',
      limitName: 'Codex',
      primary: { usedPercent: 25, resetsAt: null, windowDurationMins: 300 },
      secondary: { usedPercent: null, resetsAt: '2026-08-18T00:00:00Z', windowDurationMins: 10_080 }
    }])).toEqual([{
      id: 'codex:primary',
      label: 'Codex · 5h window',
      remainingPercent: 75,
      resetsAt: null
    }, {
      id: 'codex:secondary',
      label: 'Codex · 1w window',
      remainingPercent: null,
      resetsAt: '2026-08-18T00:00:00Z'
    }])
  })

  it('builds the complete action registry with honest availability', () => {
    expect(createStatusActions({
      passthroughSupported: false,
      passthroughActive: false,
      passthroughDisabledReason: 'The current XR session is opaque.',
      voiceState: 'resume-audio',
      reducedEffects: true
    })).toEqual([
      expect.objectContaining({ id: 'passthrough', available: false, state: 'Off' }),
      expect.objectContaining({ id: 'recenter' }),
      expect.objectContaining({ id: 'voice', label: 'Resume audio' }),
      expect.objectContaining({ id: 'reduced-effects', state: 'On' }),
      expect.objectContaining({ id: 'exit' })
    ])
  })

  it('lays out future action rows without a fixed five-action hit contract', () => {
    const rows = createStatusActionRowLayout(8)
    expect(rows).toHaveLength(8)
    expect(rows[0]?.top).toBe(570)
    expect(rows.at(-1)!.top + rows.at(-1)!.height).toBeCloseTo(880)
    expect(rows.every((row, index) =>
      index === 0 || row.top >= rows[index - 1]!.top + rows[index - 1]!.height
    )).toBe(true)
  })

  it('narrows the window into its lower-edge pivot on dismissal', () => {
    expect(resolveStatusWindowScale('closing', 0)).toEqual({ x: 1, y: 1 })
    expect(resolveStatusWindowScale('closing', 0.5)).toEqual({ x: 0.75, y: 0.5 })
    expect(resolveStatusWindowScale('closing', 1)).toEqual({ x: 0.5, y: 0 })
  })

  it('allows hand actions only through direct fingertip contact', () => {
    expect(canActivateStatusAction({ source: 'hand', method: 'contact' })).toBe(true)
    expect(canActivateStatusAction({ source: 'hand', method: 'ray' })).toBe(false)
    expect(canActivateStatusAction({ source: 'hand', method: 'pinch' })).toBe(false)
    expect(canActivateStatusAction({ source: 'controller', method: 'ray' })).toBe(true)
    expect(canActivateStatusAction({ source: 'controller', method: 'contact' })).toBe(true)
    expect(canActivateStatusAction(
      { source: 'gaze', method: 'ray' },
      'controller-or-touch'
    )).toBe(false)
  })

  it('uses only the verified HTC Vive Focus menu component mapping', () => {
    expect(mappedMenuButtonIndex('left', ['htc-vive-focus'])).toBe(4)
    expect(mappedMenuButtonIndex('right', ['htc-vive-focus'])).toBe(null)
    expect(mappedMenuButtonIndex('left', ['htc-vive'])).toBe(null)
    expect(mappedMenuButtonIndex('left', ['unknown-extra-buttons'])).toBe(null)
  })

  it('shows the fallback exactly when no mapped menu or eligible left-hand gesture exists', () => {
    // A visible right hand cannot invoke the left-hand status gesture.
    expect(shouldShowStatusFallbackMenu({
      mappedMenuController: false,
      trackedLeftHand: false,
      leftControllerActive: false
    })).toBe(true)
    // A visible left hand can invoke the gesture when no left controller wins.
    expect(shouldShowStatusFallbackMenu({
      mappedMenuController: false,
      trackedLeftHand: true,
      leftControllerActive: false
    })).toBe(false)
    // A mapped left controller provides the invocation path.
    expect(shouldShowStatusFallbackMenu({
      mappedMenuController: true,
      trackedLeftHand: false,
      leftControllerActive: true
    })).toBe(false)
    // An unmapped left controller suppresses the left-hand gesture, so its ray
    // must retain the fallback target.
    expect(shouldShowStatusFallbackMenu({
      mappedMenuController: false,
      trackedLeftHand: true,
      leftControllerActive: true
    })).toBe(true)
    // A right controller does not suppress an eligible left hand.
    expect(shouldShowStatusFallbackMenu({
      mappedMenuController: false,
      trackedLeftHand: true,
      leftControllerActive: false
    })).toBe(false)
  })

  it('debounces the hand-back pose with hysteresis and cooldown', () => {
    const gesture = new StatusGestureModel()
    const posed = {
      tracked: true,
      controllerActive: false,
      wristHeightFromEyes: -0.2,
      handBackFacingViewer: 0.7
    }
    const closed = { open: false, invocation: null }
    expect(gesture.update({ ...posed, now: 0 }, closed)).toBe(null)
    expect(gesture.update({ ...posed, now: 699 }, closed)).toBe(null)
    expect(gesture.update({ ...posed, now: 700 }, closed)).toBe('open')
    const lowered = {
      ...posed,
      wristHeightFromEyes: -0.6,
      handBackFacingViewer: 0.1
    }
    const handOpen = { open: true, invocation: 'hand' as const }
    expect(gesture.update({ ...lowered, now: 500 }, handOpen)).toBe(null)
    expect(gesture.update({ ...lowered, now: 849 }, handOpen)).toBe(null)
    expect(gesture.update({ ...lowered, now: 850 }, handOpen)).toBe('close')
    expect(gesture.update({ ...posed, now: 1_599 }, closed)).toBe(null)
  })

  it('keeps modest post-open motion inside the pose hysteresis', () => {
    const gesture = new StatusGestureModel()
    const open = { open: true, invocation: 'hand' as const }
    const moved = {
      tracked: true,
      controllerActive: false,
      wristHeightFromEyes: -0.3,
      handBackFacingViewer: -0.2
    }
    expect(gesture.update({ ...moved, now: 0 }, open)).toBe(null)
    expect(gesture.update({ ...moved, now: 1_000 }, open)).toBe(null)
  })

  it('arms only after emergence and snapshots stale press/contact state', () => {
    const interaction = new StatusActionInteractionModel()
    interaction.updateWindow({ now: 0, open: true, fullyOpen: false })
    expect(interaction.phase).toBe('emerging')
    expect(interaction.updatePress('right-controller', true)).toBe(false)
    expect(interaction.updateContact('right-hand', 'passthrough')).toBe(null)

    interaction.updateWindow({ now: 160, open: true, fullyOpen: true })
    expect(interaction.phase).toBe('arming')
    interaction.finishFrame(339)
    expect(interaction.phase).toBe('arming')
    interaction.finishFrame(340)
    expect(interaction.phase).toBe('armed')

    expect(interaction.updatePress('right-controller', true)).toBe(false)
    expect(interaction.updateContact('right-hand', 'passthrough')).toBe(null)

    expect(interaction.updatePress('right-controller', false)).toBe(false)
    expect(interaction.updatePress('right-controller', true)).toBe(true)
    expect(interaction.updatePress('right-controller', true)).toBe(false)

    expect(interaction.updateContact('right-hand', null)).toBe(null)
    expect(interaction.updateContact('right-hand', 'passthrough'))
      .toBe('passthrough')
    expect(interaction.updateContact('right-hand', 'passthrough')).toBe(null)
  })

  it('resets action arming completely when the window closes', () => {
    const interaction = new StatusActionInteractionModel()
    interaction.updateWindow({ now: 0, open: true, fullyOpen: true })
    interaction.finishFrame(180)
    expect(interaction.phase).toBe('armed')
    interaction.updateWindow({ now: 181, open: false, fullyOpen: false })
    expect(interaction.phase).toBe('closed')
    expect(interaction.updatePress('right-controller', true)).toBe(false)
  })

  it('does not let the hand gesture close a controller-opened window', () => {
    const gesture = new StatusGestureModel()
    expect(gesture.update({
      now: 1_000,
      tracked: false,
      controllerActive: true,
      wristHeightFromEyes: -1,
      handBackFacingViewer: -1
    }, { open: true, invocation: 'controller' })).toBe(null)
  })

  it('closes controller-opened UI only after a lowered hold or tracking-loss grace', () => {
    const arm = new StatusControllerArmModel()
    const state = { open: true, invocation: 'controller' as const }
    expect(arm.update({ ...state, now: 0, tracked: true, gripHeightFromEyes: -0.6 })).toBe(null)
    expect(arm.update({ ...state, now: 249, tracked: true, gripHeightFromEyes: -0.6 })).toBe(null)
    expect(arm.update({ ...state, now: 250, tracked: true, gripHeightFromEyes: -0.6 })).toBe('close')

    const lost = new StatusControllerArmModel()
    expect(lost.update({ ...state, now: 1_000, tracked: false, gripHeightFromEyes: -1 })).toBe(null)
    expect(lost.update({ ...state, now: 1_299, tracked: false, gripHeightFromEyes: -1 })).toBe(null)
    expect(lost.update({ ...state, now: 1_300, tracked: false, gripHeightFromEyes: -1 })).toBe('close')
  })

  it('gives hand tracking loss a grace period before dismissal', () => {
    const gesture = new StatusGestureModel()
    const state = { open: true, invocation: 'hand' as const }
    const sample = {
      tracked: false,
      controllerActive: false,
      wristHeightFromEyes: -1,
      handBackFacingViewer: -1
    }
    expect(gesture.update({ ...sample, now: 0 }, state)).toBe(null)
    expect(gesture.update({ ...sample, now: 499 }, state)).toBe(null)
    expect(gesture.update({ ...sample, now: 500 }, state)).toBe('close')
  })
})

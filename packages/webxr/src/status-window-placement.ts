import { Vector3 } from 'three'

export const STATUS_WINDOW_DISTANCE_METERS = 0.4
export const STATUS_WINDOW_WRIST_RISE_METERS = 0.18
export const STATUS_WINDOW_MAX_ANCHOR_JUMP_METERS = 0.12
export const STATUS_WINDOW_FOLLOW_RATE = 12

const anchorDirection = new Vector3()

export const resolveStatusWindowAnchorPosition = (
  wristPosition: Vector3,
  viewerPosition: Vector3,
  target = new Vector3()
) => {
  target.copy(wristPosition)
  target.y += STATUS_WINDOW_WRIST_RISE_METERS
  anchorDirection.subVectors(target, viewerPosition)
  if (anchorDirection.lengthSq() < 0.0001) {
    anchorDirection.set(-0.08, 0, -1)
  }
  return target.copy(viewerPosition).add(
    anchorDirection.setLength(STATUS_WINDOW_DISTANCE_METERS)
  )
}

/**
 * Keeps a hand-opened status window at its last trustworthy world pose while
 * the selecting hand is approaching or the reveal hand is occluded. Ordinary
 * tracked motion remains smoothed and follows the left wrist.
 */
export class StatusWindowAnchorTracker {
  private readonly position = new Vector3()

  private readonly acceptedTarget = new Vector3()

  private readonly candidate = new Vector3()

  private hasPosition = false

  private hasAcceptedTarget = false

  reset() {
    this.hasPosition = false
    this.hasAcceptedTarget = false
  }

  update(input: {
    wristPosition: Vector3 | null
    viewerPosition: Vector3
    selectionEngaged: boolean
    deltaSeconds: number
  }) {
    if (input.selectionEngaged || !input.wristPosition) {
      return this.hasPosition ? this.position : null
    }

    const candidate = resolveStatusWindowAnchorPosition(
      input.wristPosition,
      input.viewerPosition,
      this.candidate
    )
    if (
      this.hasAcceptedTarget
      && candidate.distanceTo(this.acceptedTarget)
        > STATUS_WINDOW_MAX_ANCHOR_JUMP_METERS
    ) {
      return this.hasPosition ? this.position : null
    }
    this.acceptedTarget.copy(candidate)
    this.hasAcceptedTarget = true
    if (!this.hasPosition) {
      this.position.copy(candidate)
      this.hasPosition = true
      return this.position
    }

    const alpha = 1 - Math.exp(
      -STATUS_WINDOW_FOLLOW_RATE * Math.max(0, input.deltaSeconds)
    )
    this.position.lerp(candidate, alpha)
    return this.position
  }
}

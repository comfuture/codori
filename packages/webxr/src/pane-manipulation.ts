import { MathUtils, Vector3 } from 'three'

export type PaneGrabIntent = 'neutral' | 'free' | 'depth'

export const PANE_GRAB_CLASSIFICATION_THRESHOLD_METERS = 0.045
export const PANE_GRAB_DEPTH_RATIO = 1.35
export const PANE_DEPTH_ACCELERATION = 3.2
export const PANE_HAND_PINCH_LATERAL_MAX_SCALE = 4
export const PANE_MIN_VIEWER_DISTANCE_METERS = 0.65
export const PANE_MAX_VIEWER_DISTANCE_METERS = 4.5
export const PANE_SCROLL_DEAD_ZONE = 0.22
export const PANE_SCROLL_LINES_PER_SECOND = 12
export const PANE_TOUCH_MOVE_EPSILON_METERS = 0.006

export const isMeaningfulTouchDrag = (
  displacement: Pick<Vector3, 'x' | 'y' | 'z'>,
  epsilon = PANE_TOUCH_MOVE_EPSILON_METERS
) => Math.hypot(
  displacement.x,
  displacement.y,
  displacement.z
) >= epsilon

export const classifyPaneGrabIntent = (
  viewerLocalDisplacement: Pick<Vector3, 'x' | 'y' | 'z'>,
  current: PaneGrabIntent = 'neutral',
  threshold = PANE_GRAB_CLASSIFICATION_THRESHOLD_METERS,
  depthRatio = PANE_GRAB_DEPTH_RATIO
): PaneGrabIntent => {
  if (current !== 'neutral') {
    return current
  }
  const lateral = Math.hypot(
    viewerLocalDisplacement.x,
    viewerLocalDisplacement.y
  )
  const depth = Math.abs(viewerLocalDisplacement.z)
  if (Math.hypot(lateral, depth) < threshold) {
    return 'neutral'
  }
  return depth >= lateral * depthRatio ? 'depth' : 'free'
}

export const resolveAcceleratedPaneDepth = (input: {
  initialDistance: number
  physicalDepth: number
  activationPhysicalDepth: number
  acceleration?: number
  minimumDistance?: number
  maximumDistance?: number
}) => MathUtils.clamp(
  input.initialDistance
    + input.activationPhysicalDepth
    + (
      input.physicalDepth - input.activationPhysicalDepth
    ) * (input.acceleration ?? PANE_DEPTH_ACCELERATION),
  input.minimumDistance ?? PANE_MIN_VIEWER_DISTANCE_METERS,
  input.maximumDistance ?? PANE_MAX_VIEWER_DISTANCE_METERS
)

export const resolvePaneDepthActivationOffset = (input: {
  initialPanelPosition: Vector3
  initialViewerPosition: Vector3
  sightLine: Vector3
  sourceDisplacement: Vector3
  target?: Vector3
}) => {
  const physicalDepth = input.sourceDisplacement.dot(input.sightLine)
  const freePosition = new Vector3().copy(input.initialPanelPosition)
    .add(input.sourceDisplacement)
  const sightLinePosition = new Vector3().copy(input.initialViewerPosition)
    .addScaledVector(
      input.sightLine,
      input.initialViewerPosition.distanceTo(input.initialPanelPosition)
        + physicalDepth
    )
  return (input.target ?? new Vector3()).subVectors(
    freePosition,
    sightLinePosition
  )
}

export const resolveDepthLockedPanePosition = (input: {
  initialPanelPosition: Vector3
  initialViewerPosition: Vector3
  sightLine: Vector3
  physicalDepth: number
  activationPhysicalDepth: number
  activationOffset: Vector3
  target?: Vector3
}) => (input.target ?? new Vector3())
  .copy(input.initialViewerPosition)
  .addScaledVector(
    input.sightLine,
    resolveAcceleratedPaneDepth({
      initialDistance: input.initialViewerPosition.distanceTo(
        input.initialPanelPosition
      ),
      physicalDepth: input.physicalDepth,
      activationPhysicalDepth: input.activationPhysicalDepth
    })
  )
  .add(input.activationOffset)

/**
 * Accelerates only the sight-line component of a physical hand pull. Unlike
 * controller depth lock, the live lateral fingertip displacement remains 1:1
 * so a held pinch can still place the pane left/right and up/down.
 */
export const resolveHandPinchDepthPanePosition = (input: {
  initialPanelPosition: Vector3
  initialViewerPosition: Vector3
  initialSourcePosition: Vector3
  sightLine: Vector3
  sourceDisplacement: Vector3
  activationPhysicalDepth: number
  activationSourceDisplacement: Vector3
  target?: Vector3
}) => {
  const physicalDepth = input.sourceDisplacement.dot(input.sightLine)
  const initialSourceDistance = input.initialViewerPosition.distanceTo(
    input.initialSourcePosition
  )
  const lateralScale = MathUtils.clamp(
    initialSourceDistance > Number.EPSILON
      ? input.initialViewerPosition.distanceTo(input.initialPanelPosition)
        / initialSourceDistance
      : PANE_HAND_PINCH_LATERAL_MAX_SCALE,
    1,
    PANE_HAND_PINCH_LATERAL_MAX_SCALE
  )
  const activationLateralDepth = input.activationSourceDisplacement.dot(
    input.sightLine
  )
  return (input.target ?? new Vector3())
    .copy(input.initialViewerPosition)
    .addScaledVector(
      input.sightLine,
      resolveAcceleratedPaneDepth({
        initialDistance: input.initialViewerPosition.distanceTo(
          input.initialPanelPosition
        ),
        physicalDepth,
        activationPhysicalDepth: input.activationPhysicalDepth
      })
    )
    .add(input.activationSourceDisplacement)
    .addScaledVector(input.sightLine, -activationLateralDepth)
    .addScaledVector(
      input.sourceDisplacement,
      lateralScale
    )
    .addScaledVector(
      input.activationSourceDisplacement,
      -lateralScale
    )
    .addScaledVector(
      input.sightLine,
      -(physicalDepth - activationLateralDepth) * lateralScale
    )
}

export const applyThumbstickDeadZone = (
  value: number,
  deadZone = PANE_SCROLL_DEAD_ZONE
) => {
  if (!Number.isFinite(value) || Math.abs(value) <= deadZone) {
    return 0
  }
  return Math.sign(value) * (
    (Math.abs(value) - deadZone) / (1 - deadZone)
  )
}

export const resolvePrimaryThumbstickY = (
  source: Pick<XRInputSource, 'handedness' | 'hand' | 'targetRayMode' | 'gamepad'>
) => {
  if (
    source.handedness !== 'right'
    || source.hand
    || source.targetRayMode !== 'tracked-pointer'
    || source.gamepad?.mapping !== 'xr-standard'
  ) {
    return null
  }
  const axis = source.gamepad.axes[3]
  return typeof axis === 'number' && Number.isFinite(axis) ? axis : null
}

export const resolveThumbstickScrollDelta = (
  axis: number,
  deltaSeconds: number,
  linesPerSecond = PANE_SCROLL_LINES_PER_SECOND
) => applyThumbstickDeadZone(axis) * Math.max(0, deltaSeconds) * linesPerSecond

export const resolveHandScrollRate = (
  heldMilliseconds: number,
  minimumLinesPerSecond = 1.4,
  maximumLinesPerSecond = 11,
  accelerationMilliseconds = 1_200
) => {
  const progress = MathUtils.clamp(
    heldMilliseconds / accelerationMilliseconds,
    0,
    1
  )
  const smooth = progress * progress * (3 - (2 * progress))
  return MathUtils.lerp(minimumLinesPerSecond, maximumLinesPerSecond, smooth)
}

export type PreferredPaneInput = {
  id: string
  handedness: XRHandedness
  kind: 'controller' | 'hand'
  lastUsedAt: number
}

export class PreferredPaneInputModel {
  private readonly sources = new Map<string, PreferredPaneInput>()

  connect(source: Omit<PreferredPaneInput, 'lastUsedAt'>, now: number) {
    const hasPreferredHand = [...this.sources.values()].some(candidate =>
      candidate.handedness === source.handedness
    )
    this.sources.set(source.id, {
      ...source,
      lastUsedAt: hasPreferredHand ? Number.NEGATIVE_INFINITY : now
    })
  }

  use(id: string, now: number) {
    const source = this.sources.get(id)
    if (source) {
      source.lastUsedAt = now
    }
  }

  lose(id: string) {
    this.sources.delete(id)
  }

  preferred(handedness: XRHandedness) {
    return [...this.sources.values()]
      .filter(source => source.handedness === handedness)
      .sort((first, second) =>
        second.lastUsedAt - first.lastUsedAt
        || first.id.localeCompare(second.id)
      )[0] ?? null
  }

  clear() {
    this.sources.clear()
  }
}

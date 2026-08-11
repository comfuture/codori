import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  applyThumbstickDeadZone,
  classifyPaneGrabIntent,
  PANE_MAX_VIEWER_DISTANCE_METERS,
  PANE_MIN_VIEWER_DISTANCE_METERS,
  PreferredPaneInputModel,
  resolveAcceleratedPaneDepth,
  resolveDepthLockedPanePosition,
  resolveHandPinchDepthPanePosition,
  resolveHandScrollRate,
  resolvePaneDepthActivationOffset,
  resolvePrimaryThumbstickY,
  resolveThumbstickScrollDelta
} from '../src/pane-manipulation'

const inputSource = (input: {
  handedness?: XRHandedness
  mapping?: GamepadMappingType
  axes?: number[]
  hand?: XRHand | null
}) => ({
  handedness: input.handedness ?? 'right',
  hand: input.hand ?? null,
  targetRayMode: 'tracked-pointer',
  gamepad: {
    mapping: input.mapping ?? 'xr-standard',
    axes: input.axes ?? [0, 0, 0, 0]
  }
}) as unknown as Pick<
  XRInputSource,
  'handedness' | 'hand' | 'targetRayMode' | 'gamepad'
>

describe('pane manipulation helpers', () => {
  it('keeps jitter neutral, then classifies viewer-local intent once', () => {
    expect(classifyPaneGrabIntent(new Vector3(0.01, 0.01, -0.02)))
      .toBe('neutral')
    const depth = classifyPaneGrabIntent(new Vector3(0.005, 0.004, -0.06))
    expect(depth).toBe('depth')
    expect(classifyPaneGrabIntent(new Vector3(0.2, 0, 0), depth))
      .toBe('depth')
    expect(classifyPaneGrabIntent(new Vector3(0.06, 0.01, -0.01)))
      .toBe('free')
  })

  it('accelerates depth only after classification without a jump and clamps it', () => {
    expect(resolveAcceleratedPaneDepth({
      initialDistance: 2,
      physicalDepth: -0.06,
      activationPhysicalDepth: -0.06
    })).toBeCloseTo(1.94)
    expect(resolveAcceleratedPaneDepth({
      initialDistance: 2,
      physicalDepth: -0.16,
      activationPhysicalDepth: -0.06
    })).toBeCloseTo(1.62)
    expect(resolveAcceleratedPaneDepth({
      initialDistance: 1,
      physicalDepth: -2,
      activationPhysicalDepth: -0.05
    })).toBe(PANE_MIN_VIEWER_DISTANCE_METERS)
    expect(resolveAcceleratedPaneDepth({
      initialDistance: 4,
      physicalDepth: 2,
      activationPhysicalDepth: 0.05
    })).toBe(PANE_MAX_VIEWER_DISTANCE_METERS)
  })

  it('preserves mixed 3D displacement at depth lock and ignores later lateral jitter', () => {
    const initialViewerPosition = new Vector3(0, 1.6, 0)
    const initialPanelPosition = new Vector3(0, 1.6, -2)
    const sightLine = new Vector3(0, 0, -1)
    const activationDisplacement = new Vector3(0.018, -0.012, -0.052)
    expect(classifyPaneGrabIntent(activationDisplacement)).toBe('depth')
    const activationPhysicalDepth = activationDisplacement.dot(sightLine)
    const activationOffset = resolvePaneDepthActivationOffset({
      initialPanelPosition,
      initialViewerPosition,
      sightLine,
      sourceDisplacement: activationDisplacement
    })
    const freeAtActivation = initialPanelPosition.clone()
      .add(activationDisplacement)
    const lockedAtActivation = resolveDepthLockedPanePosition({
      initialPanelPosition,
      initialViewerPosition,
      sightLine,
      physicalDepth: activationPhysicalDepth,
      activationPhysicalDepth,
      activationOffset
    })
    expect(lockedAtActivation.x).toBeCloseTo(freeAtActivation.x, 8)
    expect(lockedAtActivation.y).toBeCloseTo(freeAtActivation.y, 8)
    expect(lockedAtActivation.z).toBeCloseTo(freeAtActivation.z, 8)

    const laterDisplacement = new Vector3(0.09, 0.07, -0.152)
    const later = resolveDepthLockedPanePosition({
      initialPanelPosition,
      initialViewerPosition,
      sightLine,
      physicalDepth: laterDisplacement.dot(sightLine),
      activationPhysicalDepth,
      activationOffset
    })
    expect(later.x).toBeCloseTo(freeAtActivation.x, 8)
    expect(later.y).toBeCloseTo(freeAtActivation.y, 8)
    expect(later.z).toBeLessThan(freeAtActivation.z - 0.2)
  })

  it('keeps live hand-pinch lateral coordinates while accelerating depth', () => {
    const initialViewerPosition = new Vector3(0, 1.6, 0)
    const initialPanelPosition = new Vector3(0, 1.6, -2)
    const initialSourcePosition = new Vector3(0, 1.6, -0.5)
    const sightLine = new Vector3(0, 0, -1)
    const activation = new Vector3(0.01, -0.005, 0.06)
    const activationPhysicalDepth = activation.dot(sightLine)
    const atActivation = resolveHandPinchDepthPanePosition({
      initialPanelPosition,
      initialViewerPosition,
      initialSourcePosition,
      sightLine,
      sourceDisplacement: activation,
      activationPhysicalDepth,
      activationSourceDisplacement: activation
    })
    const expectedAtActivation = initialPanelPosition.clone().add(activation)
    expect(atActivation.x).toBeCloseTo(expectedAtActivation.x)
    expect(atActivation.y).toBeCloseTo(expectedAtActivation.y)
    expect(atActivation.z).toBeCloseTo(expectedAtActivation.z)

    const moved = new Vector3(0.24, 0.08, 0.16)
    const later = resolveHandPinchDepthPanePosition({
      initialPanelPosition,
      initialViewerPosition,
      initialSourcePosition,
      sightLine,
      sourceDisplacement: moved,
      activationPhysicalDepth,
      activationSourceDisplacement: activation
    })
    const resolvedDepth = resolveAcceleratedPaneDepth({
      initialDistance: 2,
      physicalDepth: moved.dot(sightLine),
      activationPhysicalDepth
    })
    const currentSourceDistance = initialSourcePosition.clone()
      .add(moved)
      .distanceTo(initialViewerPosition)
    const lateralScale = resolvedDepth / currentSourceDistance
    expect(later.x).toBeCloseTo(
      activation.x + ((moved.x - activation.x) * lateralScale)
    )
    expect(later.y).toBeCloseTo(
      initialPanelPosition.y + activation.y
        + ((moved.y - activation.y) * lateralScale)
    )
    expect(later.z).toBeGreaterThan(initialPanelPosition.z + moved.z)
  })

  it('increases hand-pinch lateral gain as a pane moves farther away', () => {
    const initialViewerPosition = new Vector3()
    const initialPanelPosition = new Vector3(0, 0, -1)
    const initialSourcePosition = new Vector3(0, 0, -0.5)
    const sightLine = new Vector3(0, 0, -1)
    const activation = new Vector3(0, 0, -0.05)
    const activationPhysicalDepth = activation.dot(sightLine)
    const resolve = (sourceDisplacement: Vector3) => (
      resolveHandPinchDepthPanePosition({
        initialPanelPosition,
        initialViewerPosition,
        initialSourcePosition,
        sightLine,
        sourceDisplacement,
        activationPhysicalDepth,
        activationSourceDisplacement: activation
      })
    )

    const near = resolve(new Vector3(0.1, 0, -0.05))
    const far = resolve(new Vector3(0.1, 0, -0.45))
    expect(near.x).toBeGreaterThan(0.1)
    expect(far.x).toBeGreaterThan(near.x)
  })

  it('maps only the right xr-standard primary thumbstick Y axis', () => {
    expect(resolvePrimaryThumbstickY(inputSource({
      axes: [0.8, -0.8, 0.2, 0.65, -0.95]
    }))).toBe(0.65)
    expect(resolvePrimaryThumbstickY(inputSource({
      handedness: 'left',
      axes: [0, 0, 0, 0.7]
    }))).toBe(null)
    expect(resolvePrimaryThumbstickY(inputSource({
      mapping: '',
      axes: [0, 0, 0, 0.7, 0.95]
    }))).toBe(null)
    expect(resolvePrimaryThumbstickY(inputSource({
      axes: [0, 0, 0]
    }))).toBe(null)
  })

  it('applies a dead zone and produces frame-rate-independent scrolling', () => {
    expect(applyThumbstickDeadZone(0.2)).toBe(0)
    const at72Hz = Array.from({ length: 72 }).reduce<number>(
      total => total + resolveThumbstickScrollDelta(0.8, 1 / 72),
      0
    )
    const at120Hz = Array.from({ length: 120 }).reduce<number>(
      total => total + resolveThumbstickScrollDelta(0.8, 1 / 120),
      0
    )
    expect(at72Hz).toBeCloseTo(at120Hz, 8)
  })

  it('starts hand scrolling slowly, accelerates smoothly, and caps it', () => {
    expect(resolveHandScrollRate(0)).toBeCloseTo(1.4)
    expect(resolveHandScrollRate(600)).toBeGreaterThan(1.4)
    expect(resolveHandScrollRate(600)).toBeLessThan(11)
    expect(resolveHandScrollRate(10_000)).toBe(11)
  })

  it('tracks preferred input independently per hand and actual use', () => {
    const model = new PreferredPaneInputModel()
    model.connect({ id: 'left-controller', handedness: 'left', kind: 'controller' }, 0)
    model.connect({ id: 'right-controller', handedness: 'right', kind: 'controller' }, 1)
    model.connect({ id: 'left-hand', handedness: 'left', kind: 'hand' }, 2)
    expect(model.preferred('left')?.id).toBe('left-controller')
    expect(model.preferred('right')?.id).toBe('right-controller')

    model.use('left-hand', 10)
    expect(model.preferred('left')?.id).toBe('left-hand')
    model.lose('left-controller')
    expect(model.preferred('left')?.kind).toBe('hand')
  })
})

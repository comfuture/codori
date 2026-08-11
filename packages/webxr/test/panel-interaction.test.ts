import { describe, expect, it, vi } from 'vitest'
import {
  Group,
  Line,
  Mesh,
  Ray,
  Sphere,
  Vector3,
  type WebGLRenderer,
  type XRHandSpace,
  type XRJointSpace
} from 'three'
import {
  ImmersiveInteractionSystem,
  isPanelGrabTap,
  mappedStatusMenuButtonIndex,
  resolveFocusedPanelLocalPosition,
  resolveFocusedPanelPosition,
  resolveRayPanelPosition,
  resolveRayGrabPosition,
  resolveStatusFallbackMenuVisibility,
  worldPointToPanelLocal,
  resolveTrackedHandJoint
} from '../src/interaction-system'
import { PanelInteractionModel } from '../src/panel-interaction'

describe('panel interaction model', () => {
  it('keeps ray-grabbed pointer positions at a fixed viewer distance', () => {
    const sphere = new Sphere(new Vector3(0, 0, 0), 2)
    const offset = new Vector3()
    const first = resolveRayGrabPosition(
      new Ray(
        new Vector3(0, 0, 0),
        new Vector3(0.25, 0, -1).normalize()
      ),
      sphere,
      offset
    )!
    const second = resolveRayGrabPosition(
      new Ray(
        new Vector3(0, 0, 0),
        new Vector3(0.5, 0, -1).normalize()
      ),
      sphere,
      offset
    )!

    expect(first.length()).toBeCloseTo(2)
    expect(second.length()).toBeCloseTo(2)
    expect(second.x).toBeGreaterThan(first.x)
  })

  it('treats only a small drag-handle movement as a focus tap', () => {
    const initial = new Vector3(0, 1, -2)
    expect(isPanelGrabTap(
      initial,
      new Vector3(0.08, 1, -2)
    )).toBe(true)
    expect(isPanelGrabTap(
      initial,
      new Vector3(0.14, 1, -2)
    )).toBe(false)
  })

  it('pulls distant panels to reading distance without pushing close panels away', () => {
    const viewer = new Vector3(0, 1.65, 0)
    const distant = resolveFocusedPanelPosition(
      viewer,
      new Vector3(0.9, 1.65, -2.7)
    )
    expect(distant.distanceTo(viewer)).toBeCloseTo(1.8)
    expect(distant.x).toBeGreaterThan(0)

    const close = new Vector3(0.4, 1.5, -1.2)
    expect(resolveFocusedPanelPosition(viewer, close)).toEqual(close)
  })

  it('keeps focus and drag targets correct under a recentered yaw anchor', () => {
    const anchor = new Group()
    anchor.position.set(3, 0, -2)
    anchor.rotation.y = -Math.PI / 2
    const panel = new Group()
    panel.position.set(0.5, 1.4, -2.6)
    anchor.add(panel)
    anchor.updateMatrixWorld(true)

    const viewer = new Vector3(0, 1.65, 0)
    panel.position.copy(resolveFocusedPanelLocalPosition(viewer, panel))
    anchor.updateMatrixWorld(true)
    expect(panel.getWorldPosition(new Vector3()).distanceTo(viewer)).toBeCloseTo(1.8)

    const dragWorld = new Vector3(1.2, 1.7, -1.1)
    panel.position.copy(worldPointToPanelLocal(panel, dragWorld))
    anchor.updateMatrixWorld(true)
    expect(panel.getWorldPosition(new Vector3())).toEqual(dragWorld)
  })

  it('tracks content scrolling at the ray intersection instead of controller height', () => {
    const panel = new Group()
    panel.position.set(0, 1, -2)
    panel.updateMatrixWorld(true)

    const lower = resolveRayPanelPosition(
      new Ray(
        new Vector3(0, 1, 0),
        new Vector3(0, 0, -1)
      ),
      panel
    )!
    const higher = resolveRayPanelPosition(
      new Ray(
        new Vector3(0, 1, 0),
        new Vector3(0, 0.1, -1).normalize()
      ),
      panel
    )!
    expect(lower.y).toBeCloseTo(1)
    expect(higher.y).toBeCloseTo(1.2)
  })

  it('separates content selection from grab zones', () => {
    const model = new PanelInteractionModel()
    expect(model.grabStart('left', {
      panelId: 'panel-1',
      zone: 'content'
    })).toBe(false)
    expect(model.selectStart('left', {
      panelId: 'panel-1',
      zone: 'content'
    }, 0)).toBe(true)
    expect(model.snapshot().sources.get('left')?.selected?.zone).toBe('content')
    expect(model.snapshot().activePanelId).toBe('panel-1')
  })

  it('keeps the last selection active until another panel or empty space is selected', () => {
    const model = new PanelInteractionModel()
    model.selectStart('left', {
      panelId: 'panel-1',
      zone: 'content'
    }, 0)
    model.selectEnd('left')
    model.hover('left', null)
    expect(model.snapshot().activePanelId).toBe('panel-1')

    model.selectStart('left', {
      panelId: 'panel-2',
      zone: 'grab'
    }, 300)
    expect(model.snapshot().activePanelId).toBe('panel-2')

    model.selectEnd('left')
    model.selectStart('left', null, 600)
    expect(model.snapshot().activePanelId).toBe(null)
  })

  it('resolves competing grabs deterministically and releases on source loss', () => {
    const model = new PanelInteractionModel()
    const hit = {
      panelId: 'panel-1',
      zone: 'grab' as const
    }
    expect(model.grabStart('left', hit)).toBe(true)
    expect(model.grabStart('right', hit)).toBe(false)
    expect(model.snapshot().grabOwners.get('panel-1')).toBe('left')

    model.sourceLost('left')
    expect(model.grabStart('right', hit)).toBe(true)
    expect(model.snapshot().grabOwners.get('panel-1')).toBe('right')
  })

  it('de-duplicates synthesized hand actions after a native select', () => {
    const model = new PanelInteractionModel()
    const hit = {
      panelId: 'panel-1',
      zone: 'content' as const
    }
    expect(model.selectStart('hand', hit, 1_000, true)).toBe(true)
    expect(model.selectStart('hand', hit, 1_100, false)).toBe(false)
    expect(model.selectStart('hand', hit, 1_300, false)).toBe(true)
  })

  it('reads only currently tracked Three.js hand joints from the joints map', () => {
    const hand = Object.assign(new Group(), {
      joints: {},
      inputState: { pinching: false }
    }) as unknown as XRHandSpace
    const wrist = Object.assign(new Group(), {
      jointRadius: 0.01
    }) as unknown as XRJointSpace
    hand.joints.wrist = wrist
    hand.visible = true
    wrist.visible = true

    expect(wrist.name).toBe('')
    expect(hand.getObjectByName('wrist')).toBeUndefined()
    expect(resolveTrackedHandJoint(hand, 'wrist')).toBe(wrist)

    wrist.visible = false
    expect(resolveTrackedHandJoint(hand, 'wrist')).toBe(null)
    wrist.visible = true
    hand.visible = false
    expect(resolveTrackedHandJoint(hand, 'wrist')).toBe(null)
  })

  it('recognizes a menu controller only when its mapped button is exposed', () => {
    const source = {
      handedness: 'left',
      profiles: ['htc-vive-focus'],
      gamepad: {
        buttons: [{}, {}, {}, {}, { pressed: false }]
      }
    } as unknown as Pick<XRInputSource, 'handedness' | 'profiles' | 'gamepad'>
    expect(mappedStatusMenuButtonIndex(source)).toBe(4)
    expect(mappedStatusMenuButtonIndex({
      ...source,
      gamepad: { buttons: [{}, {}, {}, {}] } as unknown as Gamepad
    })).toBe(null)
    expect(mappedStatusMenuButtonIndex({
      ...source,
      profiles: ['unknown-controller']
    })).toBe(null)
  })

  it('shows the fallback only when the connected sources have no status invocation path', () => {
    const handSource = (handedness: XRHandedness) => {
      const hand = Object.assign(new Group(), {
        joints: {},
        inputState: { pinching: false }
      }) as unknown as XRHandSpace
      const wrist = Object.assign(new Group(), {
        jointRadius: 0.01
      }) as unknown as XRJointSpace
      hand.joints.wrist = wrist
      hand.visible = true
      wrist.visible = true
      return {
        inputSource: {
          handedness,
          hand: {},
          targetRayMode: 'tracked-pointer',
          profiles: []
        } as unknown as XRInputSource,
        hand
      }
    }
    const controllerSource = (
      handedness: XRHandedness,
      mapped: boolean
    ) => ({
      inputSource: {
        handedness,
        hand: null,
        targetRayMode: 'tracked-pointer',
        profiles: mapped ? ['htc-vive-focus'] : ['unknown-controller'],
        gamepad: {
          buttons: [{}, {}, {}, {}, { pressed: false }]
        }
      } as unknown as XRInputSource,
      hand: Object.assign(new Group(), {
        joints: {},
        inputState: { pinching: false }
      }) as unknown as XRHandSpace
    })

    const rightHand = handSource('right')
    const leftHand = handSource('left')
    const leftMappedController = controllerSource('left', true)
    const leftUnmappedController = controllerSource('left', false)
    const rightUnmappedController = controllerSource('right', false)

    expect(resolveStatusFallbackMenuVisibility([rightHand])).toBe(true)
    expect(resolveStatusFallbackMenuVisibility([leftHand])).toBe(false)
    expect(resolveStatusFallbackMenuVisibility([
      leftMappedController
    ])).toBe(false)
    expect(resolveStatusFallbackMenuVisibility([
      leftHand,
      leftUnmappedController
    ])).toBe(true)
    expect(resolveStatusFallbackMenuVisibility([
      leftHand,
      rightUnmappedController
    ])).toBe(false)
    expect(resolveStatusFallbackMenuVisibility([
      rightHand,
      leftMappedController
    ])).toBe(false)
  })

  it.each(['thumb-tip', 'index-finger-tip'] as const)(
    'ends an active synthesized pinch once when %s tracking is lost',
    (lostJointName) => {
      const targetRays = [new Group(), new Group()]
      const grips = [new Group(), new Group()]
      const hands = [0, 1].map(() => Object.assign(new Group(), {
        joints: {},
        inputState: { pinching: false }
      }) as unknown as XRHandSpace)
      const renderer = {
        xr: {
          getController: (index: number) => targetRays[index],
          getControllerGrip: (index: number) => grips[index],
          getHand: (index: number) => hands[index]
        }
      } as unknown as WebGLRenderer
      const system = new ImmersiveInteractionSystem({
        renderer,
        root: new Group(),
        getPanels: () => new Map(),
        getControlTargets: () => [],
        getStatusTargets: () => [],
        getStatusMenuTarget: () => null,
        isStatusOpen: () => false,
        getStatusInvocation: () => null,
        onScroll: () => {},
        onPanelInteracted: () => {},
        onPanelMoved: () => {},
        onPanelFocused: () => {},
        onPanelDismiss: () => {},
        onAction: () => {},
        onStatusToggle: () => {},
        onStatusDismiss: () => {},
        onStatusAction: () => {},
        onInputCapabilitiesChanged: () => {}
      })
      type TestRuntime = {
        id: string
        hand: XRHandSpace
        inputSource: XRInputSource | null
        pinching: boolean
        selecting: boolean
        grabbedBy: 'select' | 'squeeze' | 'pinch' | null
      }
      const internals = system as unknown as {
        sources: TestRuntime[]
        model: PanelInteractionModel
        updatePinch: (runtime: TestRuntime, now: number) => void
      }
      const runtime = internals.sources[0]!
      runtime.inputSource = {
        handedness: 'left',
        hand: {},
        targetRayMode: 'tracked-pointer',
        profiles: []
      } as unknown as XRInputSource
      runtime.hand.visible = true
      for (const name of ['thumb-tip', 'index-finger-tip'] as const) {
        const joint = Object.assign(new Group(), {
          jointRadius: 0.01
        }) as unknown as XRJointSpace
        joint.visible = name !== lostJointName
        runtime.hand.joints[name] = joint
      }
      const hit = { panelId: 'panel-1', zone: 'grab' as const }
      internals.model.selectStart(runtime.id, hit, 0, false)
      internals.model.grabStart(runtime.id, hit)
      runtime.pinching = true
      runtime.selecting = true
      runtime.grabbedBy = 'pinch'
      const selectEnd = vi.spyOn(internals.model, 'selectEnd')
      const releaseGrab = vi.spyOn(internals.model, 'releaseGrab')

      internals.updatePinch(runtime, 100)

      expect(runtime).toMatchObject({
        pinching: false,
        selecting: false,
        grabbedBy: null
      })
      expect(internals.model.snapshot().sources.get(runtime.id)).toMatchObject({
        selected: null,
        grabbedPanelId: null
      })
      expect(internals.model.snapshot().grabOwners).toHaveLength(0)
      expect(selectEnd).toHaveBeenCalledTimes(1)
      expect(releaseGrab).toHaveBeenCalledTimes(1)

      internals.updatePinch(runtime, 101)
      expect(selectEnd).toHaveBeenCalledTimes(1)
      expect(releaseGrab).toHaveBeenCalledTimes(1)
      system.dispose()
    }
  )

  it('removes input listeners and disposes fallback geometry on teardown', () => {
    const targetRays = [new Group(), new Group()]
    const grips = [new Group(), new Group()]
    const hands = [new Group(), new Group()]
    const renderer = {
      xr: {
        getController: (index: number) => targetRays[index],
        getControllerGrip: (index: number) => grips[index],
        getHand: (index: number) => hands[index]
      }
    } as unknown as WebGLRenderer
    const root = new Group()
    const system = new ImmersiveInteractionSystem({
      renderer,
      root,
      getPanels: () => new Map(),
      getControlTargets: () => [],
      getStatusTargets: () => [],
      getStatusMenuTarget: () => null,
      isStatusOpen: () => false,
      getStatusInvocation: () => null,
      onScroll: () => {},
      onPanelInteracted: () => {},
      onPanelMoved: () => {},
      onPanelFocused: () => {},
      onPanelDismiss: () => {},
      onAction: () => {},
      onStatusToggle: () => {},
      onStatusDismiss: () => {},
      onStatusAction: () => {},
      onInputCapabilitiesChanged: () => {}
    })
    const listenerRemoval = targetRays.map(targetRay =>
      vi.spyOn(targetRay, 'removeEventListener')
    )
    const rayGeometryDisposal = targetRays.map((targetRay) => {
      const ray = targetRay.getObjectByName('generic-controller-ray')
      if (!(ray instanceof Line)) {
        throw new Error('Expected a generic controller ray.')
      }
      return vi.spyOn(ray.geometry, 'dispose')
    })
    const gripGeometryDisposal = grips.map((grip) => {
      const marker = grip.getObjectByName('generic-controller-grip')
      if (!(marker instanceof Mesh)) {
        throw new Error('Expected a generic controller grip.')
      }
      return vi.spyOn(marker.geometry, 'dispose')
    })

    system.dispose()

    expect(listenerRemoval.every(spy => spy.mock.calls.length === 6)).toBe(true)
    expect(rayGeometryDisposal.every(spy => spy.mock.calls.length === 1)).toBe(true)
    expect(gripGeometryDisposal.every(spy => spy.mock.calls.length === 1)).toBe(true)
    expect(root.children).toHaveLength(0)
  })

  it('releases every source that points at a dismissed panel', () => {
    const model = new PanelInteractionModel()
    model.hover('left', {
      panelId: 'panel-1',
      zone: 'content'
    })
    model.grabStart('left', {
      panelId: 'panel-1',
      zone: 'grab'
    })
    model.hover('right', {
      panelId: 'panel-1',
      zone: 'dismiss'
    })

    model.dismissPanel('panel-1')

    expect(model.snapshot().grabOwners.has('panel-1')).toBe(false)
    expect(model.snapshot().sources.get('left')).toMatchObject({
      hover: null,
      grabbedPanelId: null
    })
    expect(model.snapshot().sources.get('right')?.hover).toBe(null)
    expect(model.snapshot().activePanelId).toBe(null)
  })
})

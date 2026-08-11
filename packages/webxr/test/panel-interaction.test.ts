import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  Group,
  Line,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
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
import type { SpatialPanelView } from '../src/panel-view'

const createPanelDouble = (id = 'panel-1') => {
  const group = new Group()
  group.position.z = -1
  const material = () => new MeshBasicMaterial({
    transparent: true,
    opacity: 0
  })
  const moveHit = new Mesh(new BoxGeometry(1, 1, 0.06), material())
  const dismissHit = new Mesh(new BoxGeometry(0.2, 0.2, 0.08), material())
  const scrollUpHit = new Mesh(new BoxGeometry(0.2, 0.1, 0.08), material())
  const scrollDownHit = new Mesh(new BoxGeometry(0.2, 0.1, 0.08), material())
  moveHit.userData = { panelId: id, hitZone: 'move' }
  dismissHit.userData = { panelId: id, hitZone: 'dismiss' }
  scrollUpHit.userData = { panelId: id, hitZone: 'scroll-up' }
  scrollDownHit.userData = { panelId: id, hitZone: 'scroll-down' }
  dismissHit.position.z = 0.045
  scrollUpHit.visible = false
  scrollDownHit.visible = false
  group.add(moveHit, dismissHit, scrollUpHit, scrollDownHit)
  group.updateMatrixWorld(true)
  const panel = {
    group,
    moveHit,
    dismissHit,
    scrollUpHit,
    scrollDownHit,
    maximumScrollStart: 8,
    setInteraction: vi.fn(),
    setHandControlsVisible: vi.fn(),
    moveTo: (position: Vector3) => {
      group.position.copy(position)
      group.updateMatrixWorld(true)
    }
  } as unknown as SpatialPanelView
  return { panel, group, moveHit, dismissHit, scrollUpHit, scrollDownHit }
}

const createInteractionHarness = (
  panels: ReadonlyMap<string, SpatialPanelView> = new Map()
) => {
  const targetRays = [new Group(), new Group()]
  const grips = [new Group(), new Group()]
  const hands = [0, 1].map(() => Object.assign(new Group(), {
    joints: {},
    inputState: { pinching: false }
  }) as unknown as XRHandSpace)
  const camera = new PerspectiveCamera()
  camera.position.set(0, 0, 0)
  camera.updateMatrixWorld(true)
  const renderer = {
    xr: {
      getController: (index: number) => targetRays[index],
      getControllerGrip: (index: number) => grips[index],
      getHand: (index: number) => hands[index],
      getCamera: () => camera
    }
  } as unknown as WebGLRenderer
  const root = new Group()
  for (const panel of panels.values()) {
    root.add(panel.group)
  }
  const callbacks = {
    onScroll: vi.fn(),
    onPanelInteracted: vi.fn(),
    onPanelMoved: vi.fn(),
    onPanelFocused: vi.fn(),
    onPanelDismiss: vi.fn()
  }
  const system = new ImmersiveInteractionSystem({
    renderer,
    root,
    getPanels: () => panels,
    getControlTargets: () => [],
    getStatusTargets: () => [],
    getStatusMenuTarget: () => null,
    isStatusOpen: () => false,
    getStatusInvocation: () => null,
    ...callbacks,
    onAction: () => {},
    onStatusToggle: () => {},
    onStatusDismiss: () => {},
    onStatusAction: () => {},
    onInputCapabilitiesChanged: () => {}
  })
  return { system, targetRays, grips, hands, callbacks }
}

const attachTrackedIndexTip = (
  runtime: { inputSource: XRInputSource | null },
  hand: XRHandSpace
) => {
  runtime.inputSource = {
    handedness: 'right',
    hand: {},
    targetRayMode: 'tracked-pointer'
  } as unknown as XRInputSource
  const index = Object.assign(new Group(), {
    jointRadius: 0.01
  }) as unknown as XRJointSpace
  index.position.set(0, 0, -0.96)
  index.visible = true
  hand.visible = true
  hand.joints['index-finger-tip'] = index
  hand.add(index)
  hand.updateMatrixWorld(true)
  return index
}

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

  it('treats only sub-classification movement as a focus tap', () => {
    const initial = new Vector3(0, 1, -2)
    expect(isPanelGrabTap(
      initial,
      new Vector3(0.02, 1, -2)
    )).toBe(true)
    expect(isPanelGrabTap(
      initial,
      new Vector3(0.05, 1, -2)
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

  it('treats every non-actionable pane point as a move zone', () => {
    const model = new PanelInteractionModel()
    expect(model.selectStart('left', {
      panelId: 'panel-1',
      zone: 'move'
    }, 0)).toBe(true)
    expect(model.grabStart('left', {
      panelId: 'panel-1',
      zone: 'move'
    })).toBe(true)
    expect(model.snapshot().sources.get('left')?.selected?.zone).toBe('move')
    expect(model.snapshot().activePanelId).toBe('panel-1')
  })

  it('keeps the last selection active until another panel or empty space is selected', () => {
    const model = new PanelInteractionModel()
    model.selectStart('left', {
      panelId: 'panel-1',
      zone: 'move'
    }, 0)
    model.selectEnd('left')
    model.hover('left', null)
    expect(model.snapshot().activePanelId).toBe('panel-1')

    model.selectStart('left', {
      panelId: 'panel-2',
      zone: 'move'
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
      zone: 'move' as const
    }
    expect(model.grabStart('left', hit)).toBe(true)
    expect(model.grabStart('right', hit)).toBe(false)
    expect(model.snapshot().grabOwners.get('panel-1')).toBe('left')

    model.sourceLost('left')
    expect(model.grabStart('right', hit)).toBe(true)
    expect(model.snapshot().grabOwners.get('panel-1')).toBe('right')
  })

  it('releases hover, selection, and grab when a pane disappears', () => {
    const model = new PanelInteractionModel()
    const hit = { panelId: 'panel-1', zone: 'move' as const }
    model.hover('hand', hit)
    model.selectStart('hand', hit, 0)
    model.grabStart('hand', hit)
    model.reconcilePanels(new Set())
    expect(model.snapshot().sources.get('hand')).toMatchObject({
      hover: null,
      selected: null,
      grabbedPanelId: null
    })
    expect(model.snapshot().grabOwners).toHaveLength(0)
    expect(model.snapshot().activePanelId).toBe(null)
  })

  it('de-duplicates synthesized hand actions after a native select', () => {
    const model = new PanelInteractionModel()
    const hit = {
      panelId: 'panel-1',
      zone: 'move' as const
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
      const hit = { panelId: 'panel-1', zone: 'move' as const }
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

  it('keeps dismiss hit priority over the overlapping whole-pane move target', () => {
    const { panel, dismissHit } = createPanelDouble()
    const { system } = createInteractionHarness(new Map([['panel-1', panel]]))
    const internals = system as unknown as {
      sources: unknown[]
      raycast: (runtime: unknown) => { object: Mesh } | null
    }
    const intersection = internals.raycast(internals.sources[0])
    expect(intersection?.object).toBe(dismissHit)
    system.dispose()
  })

  it('moves from the whole pane without reintroducing select-drag scrolling', () => {
    const { panel, dismissHit } = createPanelDouble()
    dismissHit.visible = false
    const { system, callbacks } = createInteractionHarness(
      new Map([['panel-1', panel]])
    )
    const internals = system as unknown as {
      sources: unknown[]
      handleSelectStart: (runtime: unknown, now: number, native: boolean) => void
    }
    internals.handleSelectStart(internals.sources[0], 0, true)
    system.update(16, 1 / 60)
    expect(callbacks.onPanelInteracted).toHaveBeenCalledWith('panel-1')
    expect(callbacks.onScroll).not.toHaveBeenCalled()
    system.dispose()
  })

  it('cancels a no-op hidden grab before clearing interaction ownership', () => {
    const hidden = createPanelDouble('hidden')
    const visible = createPanelDouble('visible')
    visible.group.position.set(1, 0, -1)
    visible.group.updateMatrixWorld(true)
    const { system, callbacks } = createInteractionHarness(new Map([
      ['hidden', hidden.panel],
      ['visible', visible.panel]
    ]))
    type Runtime = {
      id: string
      inputSource: XRInputSource | null
      grabbedBy: 'select' | null
      grabInitialPosition: Vector3
      grabMoved: boolean
      handScrollPanelId: string | null
      handScrollDirection: number
    }
    const internals = system as unknown as {
      sources: Runtime[]
      model: PanelInteractionModel
      updateGamepadScroll: (
        runtime: Runtime,
        now: number,
        deltaSeconds: number
      ) => void
      refreshPanelInteraction: () => void
    }
    const runtime = internals.sources[0]!
    runtime.inputSource = {
      handedness: 'right',
      hand: null,
      targetRayMode: 'tracked-pointer',
      gamepad: {
        mapping: 'xr-standard',
        axes: [0, 0, 0, 0.8]
      }
    } as unknown as XRInputSource
    const hit = { panelId: 'hidden', zone: 'move' as const }
    internals.model.selectStart(runtime.id, hit, 0)
    internals.model.grabStart(runtime.id, hit)
    runtime.grabbedBy = 'select'
    runtime.grabInitialPosition.copy(hidden.group.position)
    runtime.grabMoved = false
    runtime.handScrollPanelId = 'hidden'
    runtime.handScrollDirection = 1
    const visiblePosition = visible.group.position.clone()

    internals.updateGamepadScroll(runtime, 0, 1 / 60)
    expect(callbacks.onScroll).toHaveBeenCalledTimes(1)
    hidden.group.visible = false
    internals.updateGamepadScroll(runtime, 16, 1 / 60)
    expect(callbacks.onScroll).toHaveBeenCalledTimes(1)

    internals.refreshPanelInteraction()
    expect(internals.model.snapshot()).toMatchObject({
      activePanelId: null
    })
    expect(internals.model.snapshot().grabOwners).toHaveLength(0)
    expect(runtime).toMatchObject({
      grabbedBy: null,
      handScrollPanelId: null,
      handScrollDirection: 0
    })
    expect(hidden.group.position).toEqual(new Vector3(0, 0, -1))
    expect(callbacks.onPanelMoved).not.toHaveBeenCalled()
    expect(visible.group.position).toEqual(visiblePosition)
    internals.updateGamepadScroll(runtime, 32, 1 / 60)
    expect(callbacks.onScroll).toHaveBeenCalledTimes(1)
    system.dispose()
  })

  it('persists a meaningful grab before its pane becomes hidden', () => {
    const hidden = createPanelDouble('hidden')
    const visible = createPanelDouble('visible')
    visible.group.position.set(1, 0, -1)
    visible.group.updateMatrixWorld(true)
    const { system, callbacks } = createInteractionHarness(new Map([
      ['hidden', hidden.panel],
      ['visible', visible.panel]
    ]))
    type Runtime = {
      id: string
      grabbedBy: 'touch' | null
      grabInitialPosition: Vector3
      grabMoved: boolean
    }
    const internals = system as unknown as {
      sources: Runtime[]
      model: PanelInteractionModel
      refreshPanelInteraction: () => void
    }
    const runtime = internals.sources[0]!
    const hit = { panelId: 'hidden', zone: 'move' as const }
    internals.model.grabStart(runtime.id, hit)
    runtime.grabbedBy = 'touch'
    runtime.grabInitialPosition.copy(hidden.group.position)
    runtime.grabMoved = true
    const movedPosition = new Vector3(0.18, 0.06, -1.15)
    hidden.panel.moveTo(movedPosition)
    const visiblePosition = visible.group.position.clone()
    let storedPosition: Vector3 | null = null
    callbacks.onPanelMoved.mockImplementation((_panelId, position) => {
      storedPosition = position.clone()
    })

    hidden.group.visible = false
    internals.refreshPanelInteraction()

    expect(callbacks.onPanelMoved).toHaveBeenCalledTimes(1)
    expect(callbacks.onPanelMoved).toHaveBeenCalledWith(
      'hidden',
      movedPosition
    )
    expect(storedPosition).toEqual(movedPosition)
    expect(hidden.group.position).toEqual(movedPosition)
    expect(runtime.grabbedBy).toBe(null)
    expect(internals.model.snapshot().grabOwners).toHaveLength(0)
    expect(visible.group.position).toEqual(visiblePosition)

    hidden.group.visible = true
    internals.refreshPanelInteraction()

    expect(callbacks.onPanelMoved).toHaveBeenCalledTimes(1)
    expect(hidden.group.position).toEqual(storedPosition)
    expect(visible.group.position).toEqual(visiblePosition)
    system.dispose()
  })

  it('does not persist a normal-only fingertip withdrawal as manual placement', () => {
    const { panel, group } = createPanelDouble()
    const { system, hands, callbacks } = createInteractionHarness(
      new Map([['panel-1', panel]])
    )
    type Runtime = {
      inputSource: XRInputSource | null
      hand: XRHandSpace
      grabbedBy: 'touch' | null
    }
    const internals = system as unknown as {
      sources: Runtime[]
      model: PanelInteractionModel
      updateHandPaneContact: (
        runtime: Runtime,
        now: number,
        deltaSeconds: number
      ) => void
    }
    const runtime = internals.sources[0]!
    const index = attachTrackedIndexTip(runtime, hands[0]!)
    const initialPosition = group.position.clone()

    internals.updateHandPaneContact(runtime, 0, 1 / 60)
    index.position.z = -0.7
    hands[0]!.updateMatrixWorld(true)
    internals.updateHandPaneContact(runtime, 16, 1 / 60)

    expect(runtime.grabbedBy).toBe(null)
    expect(internals.model.snapshot().grabOwners).toHaveLength(0)
    expect(group.position).toEqual(initialPosition)
    expect(callbacks.onPanelMoved).not.toHaveBeenCalled()
    system.dispose()
  })

  it('persists a small meaningful in-plane fingertip drag', () => {
    const { panel, group } = createPanelDouble()
    const { system, hands, callbacks } = createInteractionHarness(
      new Map([['panel-1', panel]])
    )
    type Runtime = {
      inputSource: XRInputSource | null
      hand: XRHandSpace
      grabbedBy: 'touch' | null
    }
    const internals = system as unknown as {
      sources: Runtime[]
      updateHandPaneContact: (
        runtime: Runtime,
        now: number,
        deltaSeconds: number
      ) => void
    }
    const runtime = internals.sources[0]!
    const index = attachTrackedIndexTip(runtime, hands[0]!)

    internals.updateHandPaneContact(runtime, 0, 1 / 60)
    index.position.x = 0.008
    hands[0]!.updateMatrixWorld(true)
    internals.updateHandPaneContact(runtime, 16, 1 / 60)
    expect(group.position.x).toBeCloseTo(0.008)

    index.position.z = -0.7
    hands[0]!.updateMatrixWorld(true)
    internals.updateHandPaneContact(runtime, 32, 1 / 60)

    expect(callbacks.onPanelMoved).toHaveBeenCalledTimes(1)
    expect(callbacks.onPanelMoved).toHaveBeenCalledWith(
      'panel-1',
      expect.objectContaining({ x: expect.closeTo(0.008) })
    )
    system.dispose()
  })

  it('persists source-loss movement once but ignores source loss before movement', () => {
    const before = createPanelDouble('before')
    const beforeHarness = createInteractionHarness(
      new Map([['before', before.panel]])
    )
    type Runtime = {
      inputSource: XRInputSource | null
      hand: XRHandSpace
      listeners: { disconnected: () => void }
    }
    type Internals = {
      sources: Runtime[]
      updateHandPaneContact: (
        runtime: Runtime,
        now: number,
        deltaSeconds: number
      ) => void
    }
    const beforeInternals = beforeHarness.system as unknown as Internals
    const beforeRuntime = beforeInternals.sources[0]!
    const beforeIndex = attachTrackedIndexTip(
      beforeRuntime,
      beforeHarness.hands[0]!
    )
    beforeInternals.updateHandPaneContact(beforeRuntime, 0, 1 / 60)
    beforeIndex.position.x = 0.004
    beforeHarness.hands[0]!.updateMatrixWorld(true)
    beforeInternals.updateHandPaneContact(beforeRuntime, 16, 1 / 60)
    beforeRuntime.listeners.disconnected()
    expect(beforeHarness.callbacks.onPanelMoved).not.toHaveBeenCalled()
    expect(before.group.position).toEqual(new Vector3(0, 0, -1))
    beforeHarness.system.dispose()

    const after = createPanelDouble('after')
    const afterHarness = createInteractionHarness(
      new Map([['after', after.panel]])
    )
    const afterInternals = afterHarness.system as unknown as Internals
    const afterRuntime = afterInternals.sources[0]!
    const afterIndex = attachTrackedIndexTip(
      afterRuntime,
      afterHarness.hands[0]!
    )
    afterInternals.updateHandPaneContact(afterRuntime, 0, 1 / 60)
    afterIndex.position.x = 0.008
    afterHarness.hands[0]!.updateMatrixWorld(true)
    afterInternals.updateHandPaneContact(afterRuntime, 16, 1 / 60)
    afterRuntime.listeners.disconnected()
    afterRuntime.listeners.disconnected()
    expect(afterHarness.callbacks.onPanelMoved).toHaveBeenCalledTimes(1)
    expect(afterHarness.callbacks.onPanelMoved).toHaveBeenCalledWith(
      'after',
      expect.objectContaining({ x: expect.closeTo(0.008) })
    )
    afterHarness.system.dispose()
  })

  it('direct-touch drags a nearby pane and releases all ownership on source loss', () => {
    const { panel, group } = createPanelDouble()
    const { system, hands, callbacks } = createInteractionHarness(
      new Map([['panel-1', panel]])
    )
    type Runtime = {
      id: string
      inputSource: XRInputSource | null
      hand: XRHandSpace
      grabbedBy: 'touch' | null
      handScrollPanelId: string | null
      handScrollDirection: number
      listeners: { disconnected: () => void }
    }
    const internals = system as unknown as {
      sources: Runtime[]
      model: PanelInteractionModel
      updateHandPaneContact: (
        runtime: Runtime,
        now: number,
        deltaSeconds: number
      ) => void
    }
    const runtime = internals.sources[0]!
    runtime.inputSource = {
      handedness: 'right',
      hand: {},
      targetRayMode: 'tracked-pointer'
    } as unknown as XRInputSource
    const index = Object.assign(new Group(), {
      jointRadius: 0.01
    }) as unknown as XRJointSpace
    index.position.set(0, 0, -0.96)
    index.visible = true
    hands[0]!.visible = true
    hands[0]!.joints['index-finger-tip'] = index
    hands[0]!.add(index)
    hands[0]!.updateMatrixWorld(true)

    internals.updateHandPaneContact(runtime, 0, 1 / 60)
    expect(runtime.grabbedBy).toBe('touch')
    expect(internals.model.snapshot().grabOwners.get('panel-1')).toBe(runtime.id)

    index.position.x = 0.12
    hands[0]!.updateMatrixWorld(true)
    internals.updateHandPaneContact(runtime, 16, 1 / 60)
    expect(group.position.x).toBeCloseTo(0.12)

    index.position.z = -0.7
    hands[0]!.updateMatrixWorld(true)
    internals.updateHandPaneContact(runtime, 32, 1 / 60)
    expect(runtime.grabbedBy).toBe(null)
    expect(internals.model.snapshot().grabOwners).toHaveLength(0)

    index.position.z = -0.96
    hands[0]!.updateMatrixWorld(true)
    internals.updateHandPaneContact(runtime, 48, 1 / 60)
    expect(runtime.grabbedBy).toBe('touch')

    runtime.handScrollPanelId = 'panel-1'
    runtime.handScrollDirection = 1
    runtime.listeners.disconnected()
    expect(internals.model.snapshot().grabOwners).toHaveLength(0)
    expect(runtime).toMatchObject({
      grabbedBy: null,
      handScrollPanelId: null,
      handScrollDirection: 0
    })
    expect(callbacks.onPanelMoved).toHaveBeenCalledWith(
      'panel-1',
      expect.any(Vector3)
    )
    expect(callbacks.onPanelMoved).toHaveBeenCalledTimes(1)
    system.dispose()
  })

  it('prioritizes hand scroll controls, accelerates, and stops on leave', () => {
    const { panel, scrollDownHit } = createPanelDouble()
    scrollDownHit.visible = true
    scrollDownHit.position.set(0, -0.4, 0.045)
    const { system, hands, callbacks } = createInteractionHarness(
      new Map([['panel-1', panel]])
    )
    type Runtime = {
      inputSource: XRInputSource | null
      hand: XRHandSpace
      handScrollPanelId: string | null
      handScrollDirection: number
    }
    const internals = system as unknown as {
      sources: Runtime[]
      updateHandPaneContact: (
        runtime: Runtime,
        now: number,
        deltaSeconds: number
      ) => void
    }
    const runtime = internals.sources[0]!
    runtime.inputSource = {
      handedness: 'right',
      hand: {},
      targetRayMode: 'tracked-pointer'
    } as unknown as XRInputSource
    const index = Object.assign(new Group(), {
      jointRadius: 0.01
    }) as unknown as XRJointSpace
    index.position.set(0, -0.4, -0.91)
    index.visible = true
    hands[0]!.visible = true
    hands[0]!.joints['index-finger-tip'] = index
    hands[0]!.add(index)
    hands[0]!.updateMatrixWorld(true)

    internals.updateHandPaneContact(runtime, 0, 0.1)
    const initialDelta = callbacks.onScroll.mock.calls[0]?.[1] as number
    internals.updateHandPaneContact(runtime, 1_200, 0.1)
    const acceleratedDelta = callbacks.onScroll.mock.calls[1]?.[1] as number
    expect(initialDelta).toBeGreaterThan(0)
    expect(acceleratedDelta).toBeGreaterThan(initialDelta)
    expect(runtime.handScrollPanelId).toBe('panel-1')

    index.position.set(2, 2, -0.5)
    hands[0]!.updateMatrixWorld(true)
    internals.updateHandPaneContact(runtime, 1_300, 0.1)
    expect(runtime.handScrollPanelId).toBe(null)
    expect(callbacks.onScroll).toHaveBeenCalledTimes(2)
    system.dispose()
  })

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
      zone: 'move'
    })
    model.grabStart('left', {
      panelId: 'panel-1',
      zone: 'move'
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

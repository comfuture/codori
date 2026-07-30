import {
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Quaternion,
  Raycaster,
  type Ray,
  Sphere,
  SphereGeometry,
  Vector3,
  type Object3D,
  type WebGLRenderer,
  type XRGripSpace,
  type XRHandSpace,
  type XRTargetRaySpace
} from 'three'
import {
  PanelInteractionModel,
  type PanelHit
} from './panel-interaction'
import type { SpatialPanelView } from './panel-view'
import type { WorldControlAction } from './world-controls'

type SourceRuntime = {
  id: string
  targetRay: XRTargetRaySpace
  grip: XRGripSpace
  hand: XRHandSpace
  ray: Line<BufferGeometry, LineBasicMaterial>
  gripMarker: Mesh<SphereGeometry, MeshBasicMaterial>
  inputSource: XRInputSource | null
  selecting: boolean
  pinching: boolean
  grabbedBy: 'select' | 'squeeze' | 'pinch' | null
  lastPointerY: number
  grabOffset: Vector3
  grabSphere: Sphere
  grabInitialPosition: Vector3
  grabMoved: boolean
  listeners: {
    connected: (event: unknown) => void
    disconnected: () => void
    selectstart: () => void
    selectend: () => void
    squeezestart: () => void
    squeezeend: () => void
  } | null
}

export type InteractionSystemOptions = {
  renderer: WebGLRenderer
  root: Object3D
  getPanels: () => ReadonlyMap<string, SpatialPanelView>
  getControlTargets: () => readonly Mesh[]
  onScroll: (panelId: string, deltaLines: number) => void
  onPanelInteracted: (panelId: string) => void
  onPanelMoved: (panelId: string, position: Vector3) => void
  onPanelFocused: (panelId: string, position: Vector3) => void
  onPanelDismiss: (panelId: string) => void
  onAction: (action: WorldControlAction) => void
}

const rayOrigin = new Vector3()
const rayDirection = new Vector3()
const sourcePosition = new Vector3()
const rotationMatrix = new Matrix4()
const thumbPosition = new Vector3()
const indexPosition = new Vector3()
const viewerPosition = new Vector3()
const focusedPanelDirection = new Vector3()
const panelPlane = new Plane()
const panelPlaneNormal = new Vector3()
const panelPlanePosition = new Vector3()
const panelPlaneQuaternion = new Quaternion()
const PANEL_GRAB_TAP_MAX_DISTANCE_METERS = 0.12
const PANEL_FOCUSED_DISTANCE_METERS = 1.8

export const isPanelGrabTap = (
  initialPosition: Vector3,
  currentPosition: Vector3
) => initialPosition.distanceTo(currentPosition)
  <= PANEL_GRAB_TAP_MAX_DISTANCE_METERS

export const resolveRayGrabPosition = (
  ray: Ray,
  sphere: Sphere,
  offset: Vector3,
  target = new Vector3()
) => {
  const intersection = ray.intersectSphere(sphere, target)
  return intersection?.add(offset) ?? null
}

export const resolveFocusedPanelPosition = (
  viewer: Vector3,
  panel: Vector3,
  target = new Vector3()
) => {
  focusedPanelDirection.subVectors(panel, viewer)
  const distance = focusedPanelDirection.length()
  if (
    distance <= PANEL_FOCUSED_DISTANCE_METERS
    || distance < Number.EPSILON
  ) {
    return target.copy(panel)
  }
  return target.copy(viewer).addScaledVector(
    focusedPanelDirection.divideScalar(distance),
    PANEL_FOCUSED_DISTANCE_METERS
  )
}

export const resolveRayPanelPosition = (
  ray: Ray,
  panel: Object3D,
  target = new Vector3()
) => {
  panel.getWorldPosition(panelPlanePosition)
  panel.getWorldQuaternion(panelPlaneQuaternion)
  panelPlaneNormal
    .set(0, 0, 1)
    .applyQuaternion(panelPlaneQuaternion)
    .normalize()
  panelPlane.setFromNormalAndCoplanarPoint(
    panelPlaneNormal,
    panelPlanePosition
  )
  return ray.intersectPlane(panelPlane, target)
}

export class ImmersiveInteractionSystem {
  private readonly model = new PanelInteractionModel()

  private readonly raycaster = new Raycaster()

  private readonly sources: SourceRuntime[] = []

  private disposed = false

  constructor(private readonly options: InteractionSystemOptions) {
    for (let index = 0; index < 2; index += 1) {
      this.sources.push(this.createSource(index))
    }
  }

  private createSource(index: number): SourceRuntime {
    const id = `xr-input-${index}`
    const targetRay = this.options.renderer.xr.getController(index)
    const grip = this.options.renderer.xr.getControllerGrip(index)
    const hand = this.options.renderer.xr.getHand(index)

    const ray = new Line(
      new BufferGeometry().setFromPoints([
        new Vector3(0, 0, 0),
        new Vector3(0, 0, -1)
      ]),
      new LineBasicMaterial({
        color: '#63dcff',
        transparent: true,
        opacity: 0.48
      })
    )
    ray.name = 'generic-controller-ray'
    ray.scale.z = 3.5
    targetRay.add(ray)

    const gripMarker = new Mesh(
      new SphereGeometry(0.035, 12, 8),
      new MeshBasicMaterial({
        color: '#6cddff',
        transparent: true,
        opacity: 0.45
      })
    )
    gripMarker.name = 'generic-controller-grip'
    grip.add(gripMarker)
    this.options.root.add(targetRay, grip, hand)

    const runtime: SourceRuntime = {
      id,
      targetRay,
      grip,
      hand,
      ray,
      gripMarker,
      inputSource: null,
      selecting: false,
      pinching: false,
      grabbedBy: null,
      lastPointerY: 0,
      grabOffset: new Vector3(),
      grabSphere: new Sphere(),
      grabInitialPosition: new Vector3(),
      grabMoved: false,
      listeners: null
    }
    const listeners = {
      connected: (event: unknown) => {
        runtime.inputSource = (
          event as unknown as { data: XRInputSource }
        ).data
      },
      disconnected: () => {
        const grabbedPanelId = this.model.snapshot().sources
          .get(id)?.grabbedPanelId
        runtime.inputSource = null
        runtime.selecting = false
        runtime.pinching = false
        runtime.grabbedBy = null
        this.model.sourceLost(id)
        if (grabbedPanelId) {
          const panel = this.options.getPanels().get(grabbedPanelId)
          if (panel) {
            this.options.onPanelMoved(
              grabbedPanelId,
              panel.group.position.clone()
            )
          }
        }
        this.refreshPanelInteraction()
      },
      selectstart: () => {
        this.handleSelectStart(runtime, performance.now(), true)
      },
      selectend: () => {
        runtime.selecting = false
        this.model.selectEnd(id)
        if (runtime.grabbedBy === 'select') {
          this.releaseGrab(runtime, true)
        }
      },
      squeezestart: () => {
        this.handleGrabStart(runtime, 'squeeze')
      },
      squeezeend: () => {
        if (runtime.grabbedBy === 'squeeze') {
          this.releaseGrab(runtime)
        }
      }
    }
    runtime.listeners = listeners
    targetRay.addEventListener('connected', listeners.connected)
    targetRay.addEventListener('disconnected', listeners.disconnected)
    targetRay.addEventListener('selectstart', listeners.selectstart)
    targetRay.addEventListener('selectend', listeners.selectend)
    targetRay.addEventListener('squeezestart', listeners.squeezestart)
    targetRay.addEventListener('squeezeend', listeners.squeezeend)
    return runtime
  }

  private interactionTargets() {
    const targets: Object3D[] = []
    for (const panel of this.options.getPanels().values()) {
      if (!panel.group.visible) {
        continue
      }
      targets.push(panel.contentHit, panel.grabHit)
      if (panel.dismissHit.visible && panel.dismissHit.parent?.visible) {
        targets.push(panel.dismissHit)
      }
    }
    targets.push(...this.options.getControlTargets())
    return targets
  }

  private hitFromObject(object: Object3D): PanelHit | null {
    const panelId = object.userData.panelId
    const hitZone = object.userData.hitZone
    if (
      typeof panelId === 'string'
      && (
        hitZone === 'content'
        || hitZone === 'grab'
        || hitZone === 'dismiss'
      )
    ) {
      return {
        panelId,
        zone: hitZone
      }
    }
    return null
  }

  private updateTargetRay(runtime: SourceRuntime) {
    runtime.targetRay.getWorldPosition(rayOrigin)
    rotationMatrix.extractRotation(runtime.targetRay.matrixWorld)
    rayDirection.set(0, 0, -1).applyMatrix4(rotationMatrix).normalize()
    this.raycaster.set(rayOrigin, rayDirection)
  }

  private raycast(runtime: SourceRuntime) {
    this.updateTargetRay(runtime)
    return this.raycaster.intersectObjects(this.interactionTargets(), false)[0] ?? null
  }

  private handleSelectStart(
    runtime: SourceRuntime,
    now: number,
    native: boolean
  ) {
    const intersection = this.raycast(runtime)
    const action = intersection?.object.userData.action
    if (action === 'toggle-voice' || action === 'exit-xr') {
      this.options.onAction(action)
      return
    }
    const hit = intersection ? this.hitFromObject(intersection.object) : null
    if (hit?.zone === 'dismiss') {
      const snapshot = this.model.snapshot()
      for (const source of this.sources) {
        if (
          snapshot.sources.get(source.id)?.grabbedPanelId
          === hit.panelId
        ) {
          source.grabbedBy = null
        }
      }
      this.model.dismissPanel(hit.panelId)
      this.options.onPanelDismiss(hit.panelId)
      this.refreshPanelInteraction()
      return
    }
    if (!this.model.selectStart(runtime.id, hit, now, native)) {
      this.refreshPanelInteraction()
      return
    }
    if (hit) {
      this.options.onPanelInteracted(hit.panelId)
    }
    runtime.selecting = true
    runtime.lastPointerY = intersection?.point.y ?? 0
    if (hit?.zone === 'grab') {
      this.handleGrabStart(runtime, native ? 'select' : 'pinch')
    }
  }

  private handleGrabStart(
    runtime: SourceRuntime,
    activation: NonNullable<SourceRuntime['grabbedBy']>
  ) {
    const intersection = this.raycast(runtime)
    const hit = intersection ? this.hitFromObject(intersection.object) : null
    if (!this.model.grabStart(runtime.id, hit)) {
      return
    }
    runtime.grabbedBy = activation
    const panel = hit
      ? this.options.getPanels().get(hit.panelId)
      : null
    if (!panel) {
      return
    }
    if (activation === 'squeeze') {
      this.options.onPanelInteracted(hit!.panelId)
    }
    runtime.grabInitialPosition.copy(panel.group.position)
    runtime.grabMoved = false
    if (activation === 'select' || activation === 'pinch') {
      this.options.renderer.xr.getCamera()
        .getWorldPosition(viewerPosition)
      runtime.grabSphere.center.copy(viewerPosition)
      runtime.grabSphere.radius = Math.max(
        0.25,
        viewerPosition.distanceTo(intersection!.point)
      )
      panel.group.getWorldPosition(sourcePosition)
      runtime.grabOffset.copy(sourcePosition).sub(intersection!.point)
      this.refreshPanelInteraction()
      return
    }
    runtime.grip.getWorldPosition(sourcePosition)
    if (!runtime.inputSource?.gripSpace) {
      runtime.targetRay.getWorldPosition(sourcePosition)
    }
    runtime.grabOffset.copy(panel.group.position).sub(sourcePosition)
    this.refreshPanelInteraction()
  }

  private releaseGrab(runtime: SourceRuntime, focusOnTap = false) {
    const grabbedPanelId = this.model.snapshot().sources
      .get(runtime.id)?.grabbedPanelId
    const activation = runtime.grabbedBy
    this.model.releaseGrab(runtime.id)
    runtime.grabbedBy = null
    if (grabbedPanelId) {
      const panel = this.options.getPanels().get(grabbedPanelId)
      if (panel) {
        if (
          focusOnTap
          && (
            activation === 'select'
            || activation === 'pinch'
          )
          && !runtime.grabMoved
        ) {
          this.options.renderer.xr.getCamera()
            .getWorldPosition(viewerPosition)
          this.options.onPanelFocused(
            grabbedPanelId,
            resolveFocusedPanelPosition(
              viewerPosition,
              panel.group.position
            )
          )
        } else {
          this.options.onPanelMoved(
            grabbedPanelId,
            panel.group.position.clone()
          )
        }
      }
    }
    this.refreshPanelInteraction()
  }

  private updatePinch(runtime: SourceRuntime, now: number) {
    if (!runtime.inputSource?.hand) {
      return
    }
    const thumb = runtime.hand.getObjectByName('thumb-tip')
    const index = runtime.hand.getObjectByName('index-finger-tip')
    if (!thumb || !index) {
      return
    }
    thumb.getWorldPosition(thumbPosition)
    index.getWorldPosition(indexPosition)
    const distance = thumbPosition.distanceTo(indexPosition)
    if (!runtime.pinching && distance <= 0.026) {
      runtime.pinching = true
      this.handleSelectStart(runtime, now, false)
    } else if (runtime.pinching && distance >= 0.038) {
      runtime.pinching = false
      runtime.selecting = false
      this.model.selectEnd(runtime.id)
      if (runtime.grabbedBy === 'pinch') {
        this.releaseGrab(runtime, true)
      }
    }
  }

  private updateGamepadScroll(runtime: SourceRuntime) {
    const axes = runtime.inputSource?.gamepad?.axes
    if (!axes || axes.length === 0) {
      return
    }
    const axis = axes.at(-1) ?? 0
    if (Math.abs(axis) < 0.22) {
      return
    }
    const hover = this.model.snapshot().sources.get(runtime.id)?.hover
    if (hover?.zone === 'content') {
      this.options.onScroll(hover.panelId, axis * 0.5)
    }
  }

  private refreshPanelInteraction() {
    const panels = this.options.getPanels()
    this.model.reconcilePanels(new Set(panels.keys()))
    const snapshot = this.model.snapshot()
    for (const [panelId, panel] of panels.entries()) {
      const sourceStates = [...snapshot.sources.values()]
      const hovered = sourceStates.some(
        source => source.hover?.panelId === panelId
      )
      const grabHovered = sourceStates.some(source =>
        source.hover?.panelId === panelId
        && source.hover.zone === 'grab'
      )
      const grabbed = snapshot.grabOwners.has(panelId)
      panel.setInteraction(
        hovered,
        grabbed,
        grabHovered,
        snapshot.activePanelId === panelId
      )
    }
  }

  update(now: number) {
    if (this.disposed) {
      return
    }
    for (const runtime of this.sources) {
      const intersection = this.raycast(runtime)
      this.model.hover(
        runtime.id,
        intersection ? this.hitFromObject(intersection.object) : null
      )
      this.updatePinch(runtime, now)
      this.updateGamepadScroll(runtime)

      const sourceState = this.model.snapshot().sources.get(runtime.id)
      if (sourceState?.selected?.zone === 'content' && runtime.selecting) {
        const panel = this.options.getPanels().get(
          sourceState.selected.panelId
        )
        const pointer = panel
          ? resolveRayPanelPosition(
              this.raycaster.ray,
              panel.contentHit,
              sourcePosition
            )
          : null
        const delta = pointer
          ? runtime.lastPointerY - pointer.y
          : 0
        if (pointer && Math.abs(delta) > 0.0025) {
          this.options.onScroll(
            sourceState.selected.panelId,
            delta * 42
          )
          runtime.lastPointerY = pointer.y
        }
      }

      if (sourceState?.grabbedPanelId) {
        const panel = this.options.getPanels().get(sourceState.grabbedPanelId)
        if (panel) {
          if (
            runtime.grabbedBy === 'select'
            || runtime.grabbedBy === 'pinch'
          ) {
            this.updateTargetRay(runtime)
            this.options.renderer.xr.getCamera()
              .getWorldPosition(runtime.grabSphere.center)
            const position = resolveRayGrabPosition(
              this.raycaster.ray,
              runtime.grabSphere,
              runtime.grabOffset,
              sourcePosition
            )
            if (position) {
              runtime.grabMoved ||= !isPanelGrabTap(
                runtime.grabInitialPosition,
                position
              )
              panel.moveTo(position)
            }
          } else {
            runtime.grip.getWorldPosition(sourcePosition)
            if (!runtime.inputSource?.gripSpace) {
              runtime.targetRay.getWorldPosition(sourcePosition)
            }
            const position = sourcePosition.add(runtime.grabOffset)
            runtime.grabMoved ||= !isPanelGrabTap(
              runtime.grabInitialPosition,
              position
            )
            panel.moveTo(position)
          }
        }
      }
    }
    this.refreshPanelInteraction()
  }

  dispose() {
    this.disposed = true
    this.model.clear()
    for (const runtime of this.sources) {
      if (runtime.listeners) {
        runtime.targetRay.removeEventListener(
          'connected',
          runtime.listeners.connected
        )
        runtime.targetRay.removeEventListener(
          'disconnected',
          runtime.listeners.disconnected
        )
        runtime.targetRay.removeEventListener(
          'selectstart',
          runtime.listeners.selectstart
        )
        runtime.targetRay.removeEventListener(
          'selectend',
          runtime.listeners.selectend
        )
        runtime.targetRay.removeEventListener(
          'squeezestart',
          runtime.listeners.squeezestart
        )
        runtime.targetRay.removeEventListener(
          'squeezeend',
          runtime.listeners.squeezeend
        )
        runtime.listeners = null
      }
      runtime.ray.geometry.dispose()
      runtime.ray.material.dispose()
      runtime.gripMarker.geometry.dispose()
      runtime.gripMarker.material.dispose()
      runtime.targetRay.clear()
      runtime.grip.clear()
      runtime.hand.clear()
      runtime.targetRay.removeFromParent()
      runtime.grip.removeFromParent()
      runtime.hand.removeFromParent()
    }
    this.sources.length = 0
  }
}

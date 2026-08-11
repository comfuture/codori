import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Line,
  LineBasicMaterial,
  Matrix4,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  Plane,
  Quaternion,
  Raycaster,
  type Ray,
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
import {
  HandOutlineView,
  resolveHandJointRadius
} from './hand-outline-view'
import type { SpatialPanelView } from './panel-view'
import {
  classifyPaneGrabIntent,
  isMeaningfulTouchDrag,
  PANE_GRAB_CLASSIFICATION_THRESHOLD_METERS,
  PreferredPaneInputModel,
  resolveDepthLockedPanePosition,
  resolveHandPinchDepthPanePosition,
  resolveHandScrollRate,
  resolvePaneDepthActivationOffset,
  resolvePrimaryThumbstickY,
  resolveThumbstickScrollDelta,
  type PaneGrabIntent
} from './pane-manipulation'
import type { WorldControlAction } from './world-controls'
import {
  canActivateStatusAction,
  mappedMenuButtonIndex,
  shouldShowStatusFallbackMenu,
  StatusActionInteractionModel,
  StatusControllerArmModel,
  StatusGestureModel,
  type StatusActionId,
  type StatusActionInputPolicy,
  type StatusWindowInvocation,
  type StatusActivation
} from './status-window-model'

type SourceRuntime = {
  id: string
  targetRay: XRTargetRaySpace
  grip: XRGripSpace
  hand: XRHandSpace
  handOutline: HandOutlineView
  ray: Line<BufferGeometry, LineBasicMaterial>
  gripMarker: Mesh<SphereGeometry, MeshBasicMaterial>
  inputSource: XRInputSource | null
  selecting: boolean
  pinching: boolean
  statusPressActive: boolean
  grabbedBy: 'select' | 'squeeze' | 'pinch' | 'touch' | null
  grabInitialPosition: Vector3
  grabInitialWorldPosition: Vector3
  grabInitialSourcePosition: Vector3
  grabInitialViewerPosition: Vector3
  grabViewerInverseQuaternion: Quaternion
  grabSightLine: Vector3
  grabDirectNormal: Vector3
  grabIntent: PaneGrabIntent
  grabDepthActivation: number
  grabDepthActivationOffset: Vector3
  grabMoved: boolean
  handScrollPanelId: string | null
  handScrollDirection: -1 | 1 | 0
  handScrollStartedAt: number
  menuPressed: boolean
  contactActionId: StatusActionId | null
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
  getStatusTargets: () => readonly Mesh[]
  getStatusMenuTarget: () => Mesh | null
  isStatusOpen: () => boolean
  isStatusFullyOpen?: () => boolean
  getStatusInvocation: () => StatusWindowInvocation | null
  onScroll: (
    panelId: string,
    deltaLines: number,
    maximumStart?: number
  ) => void
  onPanelInteracted: (panelId: string) => void
  onPanelMoved: (panelId: string, position: Vector3) => void
  onPanelFocused: (panelId: string, position: Vector3) => void
  onPanelDismiss: (panelId: string) => void
  onAction: (action: WorldControlAction) => void
  onStatusToggle: (invocation: StatusWindowInvocation) => void
  onStatusDismiss: () => void
  onStatusAction: (action: StatusActionId) => void
  onStatusPressedChanged?: (action: StatusActionId | null) => void
  onInputCapabilitiesChanged: (input: {
    controller: boolean
    hand: boolean
    fallbackMenu: boolean
  }) => void
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
const jointQuaternion = new Quaternion()
const handBackNormal = new Vector3()
const wristToViewer = new Vector3()
const viewerToWrist = new Vector3()
const viewerForward = new Vector3()
const contactBounds = new Box3()
const sourceDisplacement = new Vector3()
const viewerLocalDisplacement = new Vector3()
const panelWorldPosition = new Vector3()
const contactDelta = new Vector3()
const viewerQuaternion = new Quaternion()
const statusLocalPoint = new Vector3()
const statusClosestLocalPoint = new Vector3()
const statusClosestWorldPoint = new Vector3()
const statusTargetPosition = new Vector3()
const PANEL_GRAB_TAP_MAX_DISTANCE_METERS = (
  PANE_GRAB_CLASSIFICATION_THRESHOLD_METERS * 0.75
)
const PANEL_FOCUSED_DISTANCE_METERS = 1.8
const STATUS_HAND_ENGAGEMENT_DISTANCE_METERS = 0.18

export const isPanelGrabTap = (
  initialPosition: Vector3,
  currentPosition: Vector3
) => initialPosition.distanceTo(currentPosition)
  <= PANEL_GRAB_TAP_MAX_DISTANCE_METERS

export const statusTargetIntersectsSphere = (
  target: Mesh<BoxGeometry>,
  center: Vector3,
  radius: number
) => {
  target.updateWorldMatrix(true, false)
  target.worldToLocal(statusLocalPoint.copy(center))
  const width = target.geometry.parameters.width as number
  const height = target.geometry.parameters.height as number
  const depth = target.geometry.parameters.depth as number
  statusClosestLocalPoint.set(
    MathUtils.clamp(statusLocalPoint.x, -width / 2, width / 2),
    MathUtils.clamp(statusLocalPoint.y, -height / 2, height / 2),
    MathUtils.clamp(statusLocalPoint.z, -depth / 2, depth / 2)
  )
  target.localToWorld(
    statusClosestWorldPoint.copy(statusClosestLocalPoint)
  )
  return statusClosestWorldPoint.distanceToSquared(center)
    <= Math.max(0, radius) ** 2
}

export const resolveTrackedHandJoint = (
  hand: XRHandSpace,
  name: XRHandJoint
) => {
  const joint = hand.joints[name]
  return hand.visible && joint?.visible ? joint : null
}

export const mappedStatusMenuButtonIndex = (
  source: Pick<XRInputSource, 'handedness' | 'profiles' | 'gamepad'>
) => {
  const index = mappedMenuButtonIndex(source.handedness, source.profiles)
  return index != null && source.gamepad?.buttons[index]
    ? index
    : null
}

export const resolveStatusFallbackMenuVisibility = (
  sources: readonly Pick<SourceRuntime, 'inputSource' | 'hand'>[]
) => {
  const trackedLeftHand = sources.some(runtime =>
    runtime.inputSource?.handedness === 'left'
    && Boolean(runtime.inputSource.hand)
    && resolveTrackedHandJoint(runtime.hand, 'wrist') !== null
  )
  const leftControllerActive = sources.some(runtime =>
    runtime.inputSource?.handedness === 'left'
    && !runtime.inputSource.hand
    && runtime.inputSource.targetRayMode === 'tracked-pointer'
  )
  const mappedMenuController = sources.some(runtime =>
    runtime.inputSource != null
    && !runtime.inputSource.hand
    && mappedStatusMenuButtonIndex(runtime.inputSource) !== null
  )
  return shouldShowStatusFallbackMenu({
    mappedMenuController,
    trackedLeftHand,
    leftControllerActive
  })
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

export const worldPointToPanelLocal = (
  panel: Object3D,
  worldPoint: Vector3,
  target = new Vector3()
) => {
  target.copy(worldPoint)
  panel.parent?.worldToLocal(target)
  return target
}

export const resolveFocusedPanelLocalPosition = (
  viewerWorld: Vector3,
  panel: Object3D,
  target = new Vector3()
) => {
  panel.getWorldPosition(panelPlanePosition)
  resolveFocusedPanelPosition(
    viewerWorld,
    panelPlanePosition,
    target
  )
  return worldPointToPanelLocal(panel, target, target)
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

  private readonly statusGesture = new StatusGestureModel()

  private readonly statusActions = new StatusActionInteractionModel()

  private readonly statusControllerArm = new StatusControllerArmModel()

  private readonly preferredInput = new PreferredPaneInputModel()

  private statusHandEngaged = false

  private statusPressedAction: StatusActionId | null = null

  private lastInputCapabilities = ''

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
    const handOutline = new HandOutlineView()

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
    hand.add(handOutline.group)
    this.options.root.add(targetRay, grip, hand)

    const runtime: SourceRuntime = {
      id,
      targetRay,
      grip,
      hand,
      handOutline,
      ray,
      gripMarker,
      inputSource: null,
      selecting: false,
      pinching: false,
      statusPressActive: false,
      grabbedBy: null,
      grabInitialPosition: new Vector3(),
      grabInitialWorldPosition: new Vector3(),
      grabInitialSourcePosition: new Vector3(),
      grabInitialViewerPosition: new Vector3(),
      grabViewerInverseQuaternion: new Quaternion(),
      grabSightLine: new Vector3(),
      grabDirectNormal: new Vector3(),
      grabIntent: 'neutral',
      grabDepthActivation: 0,
      grabDepthActivationOffset: new Vector3(),
      grabMoved: false,
      handScrollPanelId: null,
      handScrollDirection: 0,
      handScrollStartedAt: 0,
      menuPressed: false,
      contactActionId: null,
      listeners: null
    }
    const listeners = {
      connected: (event: unknown) => {
        this.preferredInput.lose(id)
        runtime.inputSource = (
          event as unknown as { data: XRInputSource }
        ).data
        runtime.handOutline.setHandedness(runtime.inputSource.handedness)
        runtime.statusPressActive = false
        runtime.contactActionId = null
        this.statusActions.updatePress(id, false)
        this.statusActions.updateContact(id, null)
        this.preferredInput.connect({
          id,
          handedness: runtime.inputSource.handedness,
          kind: runtime.inputSource.hand ? 'hand' : 'controller'
        }, performance.now())
      },
      disconnected: () => {
        runtime.selecting = false
        runtime.pinching = false
        runtime.statusPressActive = false
        this.finalizeGrab(runtime, { refresh: false })
        runtime.inputSource = null
        runtime.contactActionId = null
        runtime.handOutline.clear()
        this.statusActions.loseSource(id)
        this.stopHandScroll(runtime)
        this.preferredInput.lose(id)
        this.model.sourceLost(id)
        this.refreshPanelInteraction()
      },
      selectstart: () => {
        runtime.statusPressActive = true
        const freshStatusPress = this.statusActions.updatePress(id, true)
        this.handleSelectStart(
          runtime,
          performance.now(),
          true,
          freshStatusPress
        )
      },
      selectend: () => {
        runtime.statusPressActive = false
        this.statusActions.updatePress(id, false)
        runtime.selecting = false
        this.model.selectEnd(id)
        if (runtime.grabbedBy === 'select') {
          this.finalizeGrab(runtime, { focusSelectTap: true })
        }
      },
      squeezestart: () => {
        this.handleGrabStart(runtime, 'squeeze')
      },
      squeezeend: () => {
        if (runtime.grabbedBy === 'squeeze') {
          this.finalizeGrab(runtime)
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
      // Child actions protrude in front of the whole-pane move target, so
      // distance ordering preserves their priority even at overlapping edges.
      if (panel.dismissHit.visible && panel.dismissHit.parent?.visible) {
        targets.push(panel.dismissHit)
      }
      if (panel.scrollUpHit.visible && panel.scrollUpHit.parent?.visible) {
        targets.push(panel.scrollUpHit)
      }
      if (panel.scrollDownHit.visible && panel.scrollDownHit.parent?.visible) {
        targets.push(panel.scrollDownHit)
      }
      targets.push(panel.moveHit)
    }
    targets.push(...this.options.getControlTargets())
    if (this.options.isStatusOpen()) {
      targets.push(...this.options.getStatusTargets())
    } else {
      const menu = this.options.getStatusMenuTarget()
      if (menu?.visible && menu.parent?.visible) {
        targets.push(menu)
      }
    }
    return targets
  }

  private hitFromObject(object: Object3D): PanelHit | null {
    const panelId = object.userData.panelId
    const hitZone = object.userData.hitZone
    if (
      typeof panelId === 'string'
      && (
        hitZone === 'move'
        || hitZone === 'dismiss'
        || hitZone === 'scroll-up'
        || hitZone === 'scroll-down'
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
    native: boolean,
    freshStatusPress = false
  ) {
    const intersection = this.raycast(runtime)
    if (intersection?.object.userData.statusMenu === true) {
      this.options.onStatusToggle('fallback')
      return
    }
    const statusAction = intersection?.object.userData.statusActionId
    if (typeof statusAction === 'string') {
      this.activateStatusAction(
        runtime,
        statusAction as StatusActionId,
        native ? 'ray' : 'pinch',
        intersection!.object,
        freshStatusPress
      )
      return
    }
    if (
      native
      && this.activateControllerContact(runtime, freshStatusPress)
    ) {
      return
    }
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
      this.preferredInput.use(runtime.id, now)
      this.options.onPanelInteracted(hit.panelId)
    }
    runtime.selecting = true
    if (hit?.zone === 'move') {
      this.handleGrabStart(runtime, native ? 'select' : 'pinch')
    }
  }

  private activationSource(runtime: SourceRuntime): StatusActivation['source'] {
    if (runtime.inputSource?.hand) {
      return 'hand'
    }
    if (runtime.inputSource?.targetRayMode === 'gaze') {
      return 'gaze'
    }
    if (runtime.inputSource?.targetRayMode === 'screen') {
      return 'screen'
    }
    return 'controller'
  }

  private activateStatusAction(
    runtime: SourceRuntime,
    action: StatusActionId,
    method: StatusActivation['method'],
    target: Object3D,
    freshTransition: boolean
  ) {
    if (
      !freshTransition
      || runtime.inputSource?.handedness !== 'right'
    ) {
      return false
    }
    if (target.userData.statusActionAvailable !== true) {
      return false
    }
    const policy = target.userData.statusInputPolicy as StatusActionInputPolicy | undefined
    if (!canActivateStatusAction({
      source: this.activationSource(runtime),
      method
    }, policy)) {
      return false
    }
    if (this.activationSource(runtime) === 'hand') {
      this.statusGesture.suppress(performance.now())
    }
    this.options.onStatusAction(action)
    return true
  }

  private nearestStatusContact(point: Vector3, maximumDistance: number) {
    let nearest: { target: Mesh, distance: number } | null = null
    for (const target of this.options.getStatusTargets()) {
      target.updateWorldMatrix(true, false)
      contactBounds.setFromObject(target)
      const distance = contactBounds.distanceToPoint(point)
      if (distance <= maximumDistance && (!nearest || distance < nearest.distance)) {
        nearest = { target, distance }
      }
    }
    return nearest?.target ?? null
  }

  private nearestHandStatusContact(point: Vector3, radius: number) {
    let nearest: { target: Mesh<BoxGeometry>, distance: number } | null = null
    for (const candidate of this.options.getStatusTargets()) {
      const target = candidate as Mesh<BoxGeometry>
      if (!statusTargetIntersectsSphere(target, point, radius)) {
        continue
      }
      target.getWorldPosition(statusTargetPosition)
      const distance = statusTargetPosition.distanceToSquared(point)
      if (!nearest || distance < nearest.distance) {
        nearest = { target, distance }
      }
    }
    return nearest?.target ?? null
  }

  private activateControllerContact(
    runtime: SourceRuntime,
    freshStatusPress: boolean
  ) {
    if (
      !this.options.isStatusOpen()
      || runtime.inputSource?.hand
      || runtime.inputSource?.targetRayMode !== 'tracked-pointer'
    ) {
      return false
    }
    runtime.grip.getWorldPosition(sourcePosition)
    const target = this.nearestStatusContact(sourcePosition, 0.055)
    const action = target?.userData.statusActionId
    return typeof action === 'string'
      ? this.activateStatusAction(
          runtime,
          action as StatusActionId,
          'contact',
          target!,
          freshStatusPress
        )
      : false
  }

  private updateHandStatusContact(runtime: SourceRuntime) {
    if (!runtime.inputSource?.hand || !this.options.isStatusOpen()) {
      runtime.contactActionId = null
      this.statusActions.updateContact(runtime.id, null)
      return
    }
    const index = resolveTrackedHandJoint(
      runtime.hand,
      'index-finger-tip'
    )
    if (!index) {
      runtime.contactActionId = null
      this.statusActions.updateContact(runtime.id, null)
      return
    }
    index.getWorldPosition(indexPosition)
    const radius = resolveHandJointRadius(index.jointRadius)
    const target = this.nearestHandStatusContact(
      indexPosition,
      radius
    )
    const action = typeof target?.userData.statusActionId === 'string'
      ? target.userData.statusActionId as StatusActionId
      : null
    const freshAction = this.statusActions.updateContact(runtime.id, action)
    const thumb = resolveTrackedHandJoint(runtime.hand, 'thumb-tip')
    let pinchingNow = runtime.pinching
    if (thumb) {
      thumb.getWorldPosition(thumbPosition)
      pinchingNow ||= thumbPosition.distanceTo(indexPosition) <= 0.026
    }
    if (
      freshAction
      && runtime.inputSource.handedness === 'right'
      && !runtime.statusPressActive
      && !pinchingNow
      && !runtime.selecting
    ) {
      this.activateStatusAction(
        runtime,
        freshAction,
        'contact',
        target!,
        true
      )
    }
    runtime.contactActionId = action
  }

  private nearestPanelContact(
    point: Vector3,
    maximumDistance: number,
    zones: readonly PanelHit['zone'][]
  ) {
    let nearest: {
      panel: SpatialPanelView
      hit: PanelHit
      distance: number
    } | null = null
    for (const [panelId, panel] of this.options.getPanels()) {
      if (!panel.group.visible) {
        continue
      }
      const candidates = zones.map((zone) => ({
        zone,
        target: zone === 'scroll-up'
          ? panel.scrollUpHit
          : zone === 'scroll-down'
            ? panel.scrollDownHit
            : panel.moveHit
      }))
      for (const candidate of candidates) {
        if (!candidate.target.visible || candidate.target.parent?.visible === false) {
          continue
        }
        candidate.target.updateWorldMatrix(true, false)
        contactBounds.setFromObject(candidate.target)
        const distance = contactBounds.distanceToPoint(point)
        if (
          distance <= maximumDistance
          && (!nearest || distance < nearest.distance)
        ) {
          nearest = {
            panel,
            hit: { panelId, zone: candidate.zone },
            distance
          }
        }
      }
    }
    return nearest
  }

  private stopHandScroll(runtime: SourceRuntime) {
    runtime.handScrollPanelId = null
    runtime.handScrollDirection = 0
    runtime.handScrollStartedAt = 0
  }

  private updateHandPaneContact(
    runtime: SourceRuntime,
    now: number,
    deltaSeconds: number
  ) {
    if (!runtime.inputSource?.hand) {
      this.stopHandScroll(runtime)
      return
    }
    if (runtime.contactActionId) {
      this.stopHandScroll(runtime)
      return
    }
    const index = resolveTrackedHandJoint(runtime.hand, 'index-finger-tip')
    if (!index) {
      this.stopHandScroll(runtime)
      if (runtime.grabbedBy === 'touch') {
        this.finalizeGrab(runtime)
      }
      return
    }
    if (this.options.isStatusOpen()) {
      this.stopHandScroll(runtime)
      if (runtime.grabbedBy === 'touch') {
        this.finalizeGrab(runtime)
      }
      return
    }
    index.getWorldPosition(indexPosition)
    const radius = Math.max(0.006, index.jointRadius ?? 0.009)
    const scrollContact = this.nearestPanelContact(
      indexPosition,
      radius + 0.012,
      ['scroll-up', 'scroll-down']
    )
    if (scrollContact) {
      if (runtime.grabbedBy === 'touch') {
        this.finalizeGrab(runtime)
      }
      const direction = scrollContact.hit.zone === 'scroll-up' ? -1 : 1
      if (
        runtime.handScrollPanelId !== scrollContact.hit.panelId
        || runtime.handScrollDirection !== direction
      ) {
        runtime.handScrollPanelId = scrollContact.hit.panelId
        runtime.handScrollDirection = direction
        runtime.handScrollStartedAt = now
        this.model.activatePanel(scrollContact.hit.panelId)
        this.preferredInput.use(runtime.id, now)
        this.options.onPanelInteracted(scrollContact.hit.panelId)
      }
      this.options.onScroll(
        scrollContact.hit.panelId,
        direction * resolveHandScrollRate(now - runtime.handScrollStartedAt)
          * Math.max(0, deltaSeconds),
        scrollContact.panel.maximumScrollStart
      )
      return
    }
    this.stopHandScroll(runtime)

    if (runtime.grabbedBy === 'touch') {
      const grabbedPanelId = this.model.snapshot().sources
        .get(runtime.id)?.grabbedPanelId
      const panel = grabbedPanelId
        ? this.options.getPanels().get(grabbedPanelId)
        : null
      if (!panel) {
        this.finalizeGrab(runtime)
        return
      }
      panel.group.getWorldPosition(panelWorldPosition)
      if (
        Math.abs(
          contactDelta.subVectors(indexPosition, panelWorldPosition)
            .dot(runtime.grabDirectNormal)
        ) > radius + 0.055
      ) {
        this.finalizeGrab(runtime)
        return
      }
      sourceDisplacement.subVectors(
        indexPosition,
        runtime.grabInitialSourcePosition
      )
      sourceDisplacement.addScaledVector(
        runtime.grabDirectNormal,
        -sourceDisplacement.dot(runtime.grabDirectNormal)
      )
      runtime.grabMoved ||= isMeaningfulTouchDrag(sourceDisplacement)
      panelWorldPosition.copy(runtime.grabInitialWorldPosition)
        .add(sourceDisplacement)
      worldPointToPanelLocal(panel.group, panelWorldPosition, panelWorldPosition)
      panel.moveTo(panelWorldPosition)
      return
    }
    if (runtime.pinching || runtime.selecting) {
      return
    }
    const moveContact = this.nearestPanelContact(
      indexPosition,
      radius + 0.008,
      ['move']
    )
    if (!moveContact || !this.model.grabStart(runtime.id, moveContact.hit)) {
      return
    }
    runtime.grabbedBy = 'touch'
    runtime.grabInitialPosition.copy(moveContact.panel.group.position)
    moveContact.panel.group.getWorldPosition(runtime.grabInitialWorldPosition)
    runtime.grabInitialSourcePosition.copy(indexPosition)
    moveContact.panel.group.getWorldQuaternion(panelPlaneQuaternion)
    runtime.grabDirectNormal.set(0, 0, 1)
      .applyQuaternion(panelPlaneQuaternion)
      .normalize()
    runtime.grabMoved = false
    this.model.activatePanel(moveContact.hit.panelId)
    this.preferredInput.use(runtime.id, now)
    this.options.onPanelInteracted(moveContact.hit.panelId)
    this.refreshPanelInteraction()
  }

  private updateMenuButton(runtime: SourceRuntime) {
    const source = runtime.inputSource
    const index = source
      ? mappedStatusMenuButtonIndex(source)
      : null
    const pressed = index == null
      ? false
      : source?.gamepad?.buttons[index]?.pressed === true
    if (pressed && !runtime.menuPressed) {
      this.options.onStatusToggle('controller')
    }
    runtime.menuPressed = pressed
  }

  private updateInputCapabilities() {
    const controller = this.sources.some(runtime =>
      Boolean(runtime.inputSource)
      && !runtime.inputSource?.hand
      && runtime.inputSource?.targetRayMode === 'tracked-pointer'
    )
    const hand = this.sources.some(runtime =>
      Boolean(runtime.inputSource?.hand)
      && resolveTrackedHandJoint(runtime.hand, 'wrist') !== null
    )
    const preferredHand = (['left', 'right', 'none'] as const).some(
      handedness => this.preferredInput.preferred(handedness)?.kind === 'hand'
    )
    const fallbackMenu = resolveStatusFallbackMenuVisibility(this.sources)
    const key = `${controller}:${hand}:${preferredHand}:${fallbackMenu}`
    for (const panel of this.options.getPanels().values()) {
      panel.setHandControlsVisible(preferredHand)
    }
    if (key !== this.lastInputCapabilities) {
      this.lastInputCapabilities = key
      this.options.onInputCapabilitiesChanged({
        controller,
        hand,
        fallbackMenu
      })
    }
  }

  private updateHandOutlines() {
    for (const runtime of this.sources) {
      const source = runtime.inputSource
      if (!source?.hand) {
        runtime.handOutline.clear()
        continue
      }
      const controllerActive = this.sources.some(candidate =>
        candidate.inputSource?.handedness === source.handedness
        && !candidate.inputSource.hand
        && candidate.inputSource.targetRayMode === 'tracked-pointer'
      )
      runtime.handOutline.updateFromHand(
        runtime.hand,
        !controllerActive
      )
    }
  }

  private updateStatusGesture(now: number) {
    const leftController = this.sources.some(runtime =>
      runtime.inputSource?.handedness === 'left'
      && !runtime.inputSource.hand
      && runtime.inputSource.targetRayMode === 'tracked-pointer'
    )
    const leftHand = this.sources.find(runtime =>
      runtime.inputSource?.handedness === 'left'
      && Boolean(runtime.inputSource.hand)
    )
    const wrist = leftHand
      ? resolveTrackedHandJoint(leftHand.hand, 'wrist')
      : null
    this.options.renderer.xr.getCamera().getWorldPosition(viewerPosition)
    let height = Number.NEGATIVE_INFINITY
    let facing = Number.NEGATIVE_INFINITY
    let gaze = Number.NEGATIVE_INFINITY
    if (wrist) {
      wrist.getWorldPosition(sourcePosition)
      wrist.getWorldQuaternion(jointQuaternion)
      handBackNormal.set(0, 1, 0).applyQuaternion(jointQuaternion).normalize()
      wristToViewer.subVectors(viewerPosition, sourcePosition).normalize()
      height = sourcePosition.y - viewerPosition.y
      facing = handBackNormal.dot(wristToViewer)
      this.options.renderer.xr.getCamera().getWorldDirection(viewerForward)
      viewerToWrist.subVectors(sourcePosition, viewerPosition).normalize()
      gaze = viewerForward.dot(viewerToWrist)
    }
    const event = this.statusGesture.update({
      now,
      tracked: Boolean(wrist),
      controllerActive: leftController,
      wristHeightFromEyes: height,
      handBackFacingViewer: facing,
      gazeAtHandDot: gaze,
      rightHandEngaged: this.statusHandEngaged
    }, {
      open: this.options.isStatusOpen(),
      invocation: this.options.getStatusInvocation()
    })
    if (event === 'open') {
      this.options.onStatusToggle('hand')
    } else if (event === 'close') {
      this.options.onStatusDismiss()
    }
  }

  private updateControllerArmDismissal(now: number) {
    const leftController = this.sources.find(runtime =>
      runtime.inputSource?.handedness === 'left'
      && !runtime.inputSource.hand
      && runtime.inputSource.targetRayMode === 'tracked-pointer'
    )
    this.options.renderer.xr.getCamera().getWorldPosition(viewerPosition)
    let height = Number.NEGATIVE_INFINITY
    if (leftController) {
      const anchor = leftController.inputSource?.gripSpace
        ? leftController.grip
        : leftController.targetRay
      anchor.getWorldPosition(sourcePosition)
      height = sourcePosition.y - viewerPosition.y
    }
    if (this.statusControllerArm.update({
      now,
      tracked: Boolean(leftController),
      gripHeightFromEyes: height,
      open: this.options.isStatusOpen(),
      invocation: this.options.getStatusInvocation()
    }) === 'close') {
      this.options.onStatusDismiss()
    }
  }

  statusAnchor() {
    if (this.options.getStatusInvocation() === 'hand') {
      const hand = this.sources.find(runtime =>
        runtime.inputSource?.handedness === 'left'
        && Boolean(runtime.inputSource.hand)
      )
      const wrist = hand
        ? resolveTrackedHandJoint(hand.hand, 'wrist')
        : null
      if (wrist) {
        return wrist
      }
    }
    const controller = this.sources.find(runtime =>
      runtime.inputSource?.handedness === 'left'
      && !runtime.inputSource.hand
      && runtime.inputSource.targetRayMode === 'tracked-pointer'
    )
    if (controller) {
      return controller.inputSource?.gripSpace ? controller.grip : controller.targetRay
    }
    const hand = this.sources.find(runtime =>
      runtime.inputSource?.handedness === 'left' && runtime.inputSource.hand
    )
    return hand
      ? resolveTrackedHandJoint(hand.hand, 'wrist')
      : null
  }

  isStatusHandEngaged() {
    return this.statusHandEngaged
  }

  private updateStatusHandEngagement() {
    this.statusHandEngaged = false
    if (!this.options.isStatusOpen()) {
      return
    }
    const rightHand = this.sources.find(runtime =>
      runtime.inputSource?.handedness === 'right'
      && Boolean(runtime.inputSource.hand)
    )
    const index = rightHand
      ? resolveTrackedHandJoint(rightHand.hand, 'index-finger-tip')
      : null
    if (!index) {
      return
    }
    index.getWorldPosition(indexPosition)
    this.statusHandEngaged = this.nearestStatusContact(
      indexPosition,
      STATUS_HAND_ENGAGEMENT_DISTANCE_METERS
    ) !== null
  }

  private updateStatusPressedVisual() {
    const pressed = this.sources.find(runtime =>
      runtime.inputSource?.handedness === 'right'
      && Boolean(runtime.inputSource.hand)
      && !runtime.statusPressActive
      && !runtime.pinching
      && !runtime.selecting
      && runtime.contactActionId !== null
    )?.contactActionId ?? null
    if (pressed === this.statusPressedAction) {
      return
    }
    this.statusPressedAction = pressed
    this.options.onStatusPressedChanged?.(pressed)
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
    panel.group.getWorldPosition(runtime.grabInitialWorldPosition)
    runtime.grabMoved = false
    runtime.grabIntent = 'neutral'
    runtime.grabDepthActivation = 0
    runtime.grabDepthActivationOffset.set(0, 0, 0)
    const camera = this.options.renderer.xr.getCamera()
    camera.getWorldPosition(runtime.grabInitialViewerPosition)
    camera.getWorldQuaternion(viewerQuaternion)
    runtime.grabViewerInverseQuaternion.copy(viewerQuaternion).invert()
    runtime.grabSightLine.subVectors(
      runtime.grabInitialWorldPosition,
      runtime.grabInitialViewerPosition
    ).normalize()
    if (runtime.inputSource?.hand) {
      if (!this.handPinchPosition(runtime, runtime.grabInitialSourcePosition)) {
        runtime.grabbedBy = null
        this.model.releaseGrab(runtime.id)
        this.refreshPanelInteraction()
        return
      }
      this.refreshPanelInteraction()
      return
    }
    this.sourceAnchorPosition(runtime, sourcePosition)
    runtime.grabInitialSourcePosition.copy(sourcePosition)
    this.refreshPanelInteraction()
  }

  private handPinchPosition(runtime: SourceRuntime, target: Vector3) {
    const thumb = resolveTrackedHandJoint(runtime.hand, 'thumb-tip')
    const index = resolveTrackedHandJoint(runtime.hand, 'index-finger-tip')
    if (!thumb || !index) {
      return null
    }
    thumb.getWorldPosition(thumbPosition)
    index.getWorldPosition(indexPosition)
    return target.copy(thumbPosition).add(indexPosition).multiplyScalar(0.5)
  }

  private updateSpatialGrab(
    runtime: SourceRuntime,
    panel: SpatialPanelView,
    currentSourcePosition: Vector3
  ) {
    sourceDisplacement.subVectors(
      currentSourcePosition,
      runtime.grabInitialSourcePosition
    )
    viewerLocalDisplacement.copy(sourceDisplacement)
      .applyQuaternion(runtime.grabViewerInverseQuaternion)
    const previousIntent = runtime.grabIntent
    runtime.grabIntent = classifyPaneGrabIntent(
      viewerLocalDisplacement,
      runtime.grabIntent
    )
    const physicalDepth = sourceDisplacement.dot(runtime.grabSightLine)
    if (
      previousIntent === 'neutral'
      && runtime.grabIntent === 'depth'
    ) {
      runtime.grabDepthActivation = physicalDepth
      if (runtime.inputSource?.hand) {
        runtime.grabDepthActivationOffset.copy(sourceDisplacement)
      } else {
        resolvePaneDepthActivationOffset({
          initialPanelPosition: runtime.grabInitialWorldPosition,
          initialViewerPosition: runtime.grabInitialViewerPosition,
          sightLine: runtime.grabSightLine,
          sourceDisplacement,
          target: runtime.grabDepthActivationOffset
        })
      }
    }
    const position = runtime.grabIntent === 'depth'
      ? runtime.inputSource?.hand
        ? resolveHandPinchDepthPanePosition({
            initialPanelPosition: runtime.grabInitialWorldPosition,
            initialViewerPosition: runtime.grabInitialViewerPosition,
            initialSourcePosition: runtime.grabInitialSourcePosition,
            sightLine: runtime.grabSightLine,
            sourceDisplacement,
            activationPhysicalDepth: runtime.grabDepthActivation,
            activationSourceDisplacement: runtime.grabDepthActivationOffset,
            target: panelWorldPosition
          })
        : resolveDepthLockedPanePosition({
            initialPanelPosition: runtime.grabInitialWorldPosition,
            initialViewerPosition: runtime.grabInitialViewerPosition,
            sightLine: runtime.grabSightLine,
            physicalDepth,
            activationPhysicalDepth: runtime.grabDepthActivation,
            activationOffset: runtime.grabDepthActivationOffset,
            target: panelWorldPosition
          })
      : panelWorldPosition.copy(runtime.grabInitialWorldPosition)
        .add(sourceDisplacement)
    worldPointToPanelLocal(
      panel.group,
      position,
      position
    )
    runtime.grabMoved ||= !isPanelGrabTap(
      runtime.grabInitialPosition,
      position
    )
    panel.moveTo(position)
  }

  private sourceAnchorPosition(runtime: SourceRuntime, target: Vector3) {
    const anchor = runtime.inputSource?.gripSpace
      ? runtime.grip
      : runtime.targetRay
    return anchor.getWorldPosition(target)
  }

  private finalizeGrab(
    runtime: SourceRuntime,
    options: {
      focusSelectTap?: boolean
      refresh?: boolean
    } = {}
  ) {
    const grabbedPanelId = this.model.snapshot().sources
      .get(runtime.id)?.grabbedPanelId
    const activation = runtime.grabbedBy
    const moved = runtime.grabMoved
    this.model.releaseGrab(runtime.id)
    runtime.grabbedBy = null
    if (grabbedPanelId) {
      const panel = this.options.getPanels().get(grabbedPanelId)
      if (panel) {
        if (
          options.focusSelectTap
          && (
            activation === 'select'
            || activation === 'pinch'
          )
          && !moved
        ) {
          this.options.renderer.xr.getCamera()
            .getWorldPosition(viewerPosition)
          this.options.onPanelFocused(
            grabbedPanelId,
            resolveFocusedPanelLocalPosition(viewerPosition, panel.group)
          )
        } else if (moved) {
          this.options.onPanelMoved(
            grabbedPanelId,
            panel.group.position.clone()
          )
        } else if (activation) {
          panel.moveTo(runtime.grabInitialPosition)
        }
      }
    }
    if (options.refresh !== false) {
      this.refreshPanelInteraction()
    }
  }

  private updatePinch(runtime: SourceRuntime, now: number) {
    if (!runtime.inputSource?.hand) {
      return
    }
    if (runtime.grabbedBy === 'touch') {
      return
    }
    const thumb = resolveTrackedHandJoint(runtime.hand, 'thumb-tip')
    const index = resolveTrackedHandJoint(runtime.hand, 'index-finger-tip')
    if (!thumb || !index) {
      this.endSynthesizedPinch(runtime, false)
      return
    }
    thumb.getWorldPosition(thumbPosition)
    index.getWorldPosition(indexPosition)
    const distance = thumbPosition.distanceTo(indexPosition)
    if (!runtime.pinching && distance <= 0.026) {
      runtime.pinching = true
      this.preferredInput.use(runtime.id, now)
      this.handleSelectStart(runtime, now, false, false)
    } else if (runtime.pinching && distance >= 0.038) {
      this.endSynthesizedPinch(runtime, true)
    }
  }

  private endSynthesizedPinch(
    runtime: SourceRuntime,
    focusOnTap: boolean
  ) {
    if (!runtime.pinching) {
      return
    }
    runtime.pinching = false
    runtime.selecting = false
    this.model.selectEnd(runtime.id)
    if (runtime.grabbedBy === 'pinch') {
      this.finalizeGrab(runtime, { focusSelectTap: focusOnTap })
    }
  }

  private updateGamepadScroll(
    runtime: SourceRuntime,
    now: number,
    deltaSeconds: number
  ) {
    const source = runtime.inputSource
    if (!source) {
      return
    }
    const axis = resolvePrimaryThumbstickY(source)
    if (axis == null) {
      return
    }
    const delta = resolveThumbstickScrollDelta(axis, deltaSeconds)
    if (delta === 0) {
      return
    }
    const activePanelId = this.model.snapshot().activePanelId
    const activePanel = activePanelId
      ? this.options.getPanels().get(activePanelId)
      : null
    if (activePanelId && activePanel?.group.visible) {
      this.preferredInput.use(runtime.id, now)
      this.options.onScroll(
        activePanelId,
        delta,
        activePanel.maximumScrollStart
      )
    }
  }

  private refreshPanelInteraction() {
    const panels = this.options.getPanels()
    const interactivePanelIds = new Set(
      [...panels.entries()]
        .filter(([, panel]) => panel.group.visible)
        .map(([panelId]) => panelId)
    )
    const preReconcileSnapshot = this.model.snapshot()
    for (const runtime of this.sources) {
      const grabbedPanelId = preReconcileSnapshot.sources
        .get(runtime.id)?.grabbedPanelId
      if (
        runtime.grabbedBy
        && grabbedPanelId
        && !interactivePanelIds.has(grabbedPanelId)
      ) {
        this.finalizeGrab(runtime, { refresh: false })
      }
    }
    this.model.reconcilePanels(interactivePanelIds)
    const snapshot = this.model.snapshot()
    for (const runtime of this.sources) {
      if (
        runtime.grabbedBy
        && !snapshot.sources.get(runtime.id)?.grabbedPanelId
      ) {
        runtime.grabbedBy = null
      }
      if (
        runtime.handScrollPanelId
        && !interactivePanelIds.has(runtime.handScrollPanelId)
      ) {
        this.stopHandScroll(runtime)
      }
    }
    for (const [panelId, panel] of panels.entries()) {
      const sourceStates = [...snapshot.sources.values()]
      const hovered = sourceStates.some(
        source => source.hover?.panelId === panelId
      )
      const grabbed = snapshot.grabOwners.has(panelId)
      panel.setInteraction(
        hovered,
        grabbed,
        snapshot.activePanelId === panelId
      )
    }
  }

  update(now: number, deltaSeconds = 0) {
    if (this.disposed) {
      return
    }
    this.statusActions.updateWindow({
      now,
      open: this.options.isStatusOpen(),
      fullyOpen: this.options.isStatusFullyOpen?.() ?? false
    })
    this.updateStatusHandEngagement()
    for (const runtime of this.sources) {
      this.statusActions.updatePress(
        runtime.id,
        runtime.statusPressActive
      )
      const intersection = this.raycast(runtime)
      this.model.hover(
        runtime.id,
        intersection ? this.hitFromObject(intersection.object) : null
      )
      this.updateHandStatusContact(runtime)
      this.updateHandPaneContact(runtime, now, deltaSeconds)
      this.updatePinch(runtime, now)
      this.updateMenuButton(runtime)
      this.updateGamepadScroll(runtime, now, deltaSeconds)

      const sourceState = this.model.snapshot().sources.get(runtime.id)
      if (sourceState?.grabbedPanelId) {
        const panel = this.options.getPanels().get(sourceState.grabbedPanelId)
        if (panel?.group.visible) {
          if (runtime.grabbedBy === 'touch') {
            continue
          }
          if (runtime.inputSource?.hand) {
            const pinchPosition = this.handPinchPosition(
              runtime,
              sourcePosition
            )
            if (pinchPosition) {
              this.updateSpatialGrab(runtime, panel, pinchPosition)
            }
          } else {
            this.sourceAnchorPosition(runtime, sourcePosition)
            this.updateSpatialGrab(runtime, panel, sourcePosition)
          }
        }
      }
    }
    this.updateStatusPressedVisual()
    this.updateHandOutlines()
    this.updateInputCapabilities()
    this.updateStatusGesture(now)
    this.updateControllerArmDismissal(now)
    this.statusActions.finishFrame(now)
    this.refreshPanelInteraction()
  }

  dispose() {
    this.disposed = true
    this.model.clear()
    this.preferredInput.clear()
    this.options.onStatusPressedChanged?.(null)
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
      runtime.handOutline.dispose()
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

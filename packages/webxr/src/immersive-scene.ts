import {
  AmbientLight,
  Color,
  GridHelper,
  Group,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  Timer,
  Vector3,
  WebGLRenderer
} from 'three'
import { AgentLightView } from './agent-light-view'
import {
  viewerFacingQuaternion,
  viewerFacingLocalQuaternion,
  smoothViewerFacingQuaternion
} from './billboard'
import {
  INITIAL_LIGHT_DISTANCE_METERS,
  MAX_LIGHT_HEIGHT_METERS,
  MIN_LIGHT_HEIGHT_METERS,
  ROOM_SIZE_METERS
} from './config'
import { ImmersiveInteractionSystem } from './interaction-system'
import {
  createDevelopmentHandPose,
  HandOutlineView
} from './hand-outline-view'
import { PassthroughContrastView } from './passthrough-contrast'
import {
  AgentLightAnimator,
  type RealtimeVisualActivity
} from './light-model'
import { allocatePanelSlots } from './panel-layout'
import type { SpatialPanelSnapshot } from './panel-model'
import { SpatialPanelView } from './panel-view'
import { configureImmersiveRenderQuality } from './render-quality'
import {
  TranscriptBubbleModel,
  type TranscriptBubbleSegment
} from './transcript-bubble-model'
import { TranscriptBubbleView } from './transcript-bubble-view'
import { WorldControls, type WorldControlAction } from './world-controls'
import { WorldStatus } from './world-status'
import {
  StatusWindowView
} from './status-window-view'
import {
  resolveStatusWindowAnchorPosition,
  StatusWindowAnchorTracker
} from './status-window-placement'
import type {
  StatusActionId,
  StatusWindowInvocation,
  StatusWindowSnapshot
} from './status-window-model'
import type { ImmersiveSessionMode } from './xr-capability'
import {
  ReferenceSpaceResetModel,
  resolveWorkspaceAnchor
} from './workspace-anchor'

export type ImmersiveSceneOptions = {
  canvas: HTMLCanvasElement
  reducedEffects: () => boolean
  onAction: (action: WorldControlAction) => void
  onPanelScroll: (
    panelId: string,
    deltaLines: number,
    maximumStart?: number
  ) => void
  onPanelInteracted: (panelId: string) => void
  onPanelMoved: (panelId: string, position: Vector3) => void
  onPanelFocused: (panelId: string, position: Vector3) => void
  onPanelDismiss: (panelId: string) => void
  onPanelAppeared: (panelCount: number) => void
  onStatusAction: (action: StatusActionId) => void
  onStatusOpened: () => void
  onStatusClosed: () => void
  onStatusFallbackChanged: (visible: boolean) => void
}

const viewerPosition = new Vector3()
const viewerDirection = new Vector3()
const worldCenter = new Vector3(0, 1.65, 0)
const worldForward = new Vector3(0, 0, -1)
const floorCenter = new Vector3()
export const ROOM_FLOOR_RENDER_ORDER = -100
export const ROOM_GRID_RENDER_ORDER = -99
export const ROOM_WALL_RENDER_ORDER = -101

export const configureRoomSurfaceRendering = (
  floor: Mesh,
  grid: GridHelper,
  walls: readonly Mesh[] = []
) => {
  const floorMaterials = Array.isArray(floor.material)
    ? floor.material
    : [floor.material]
  const gridMaterials = Array.isArray(grid.material)
    ? grid.material
    : [grid.material]
  const wallMaterials = walls.flatMap(wall => (
    Array.isArray(wall.material) ? wall.material : [wall.material]
  ))
  for (const material of [
    ...floorMaterials,
    ...gridMaterials,
    ...wallMaterials
  ]) {
    material.depthWrite = false
  }
  floor.renderOrder = ROOM_FLOOR_RENDER_ORDER
  grid.renderOrder = ROOM_GRID_RENDER_ORDER
  for (const wall of walls) {
    wall.renderOrder = ROOM_WALL_RENDER_ORDER
  }
}

export const resolveWorldControlTargets = (
  voiceToggleEnabled: boolean,
  voiceTarget: Mesh,
  controlTargets: readonly Mesh[]
) => voiceToggleEnabled
  ? [voiceTarget, ...controlTargets]
  : [...controlTargets]
const statusAnchorPosition = new Vector3()
const menuWorldPosition = new Vector3()
const menuOffset = new Vector3(0.52, -0.32, -1.15)
const fallbackStatusOffset = new Vector3(-0.08, 0, -0.4)

export class ImmersiveScene {
  readonly scene = new Scene()

  readonly camera = new PerspectiveCamera(62, 1, 0.05, 60)

  readonly renderer: WebGLRenderer

  private readonly timer = new Timer()

  private readonly world = new Group()

  private readonly room = new Group()

  private readonly agentLight = new AgentLightView()

  private readonly lightAnimator = new AgentLightAnimator(0x103)

  private readonly transcriptModel = new TranscriptBubbleModel()

  private readonly transcriptView = new TranscriptBubbleView()

  private readonly controls = new WorldControls()

  private readonly status = new WorldStatus()

  private readonly statusWindow = new StatusWindowView()

  private readonly contrast = new PassthroughContrastView()

  private readonly developmentHands: HandOutlineView[] = []

  private readonly panels = new Map<string, SpatialPanelView>()

  private readonly interaction: ImmersiveInteractionSystem

  private activity: RealtimeVisualActivity = 'idle'

  private animationTimeSeconds = 0

  private transcriptSegments: TranscriptBubbleSegment[] = []

  private transcriptGeneration = 0

  private panelSnapshots: SpatialPanelSnapshot[] = []

  private placedFromViewer = false

  private disposed = false

  private readonly referenceReset = new ReferenceSpaceResetModel()

  private releaseReferenceReset: (() => void) | null = null

  private sessionMode: ImmersiveSessionMode = 'immersive-vr'

  private environmentBlendMode: XREnvironmentBlendMode = 'opaque'

  private statusInvocation: StatusWindowInvocation | null = null

  private readonly statusAnchorTracker = new StatusWindowAnchorTracker()

  private panelInteractionPreview: {
    panelId: string
    state: 'idle' | 'active' | 'hover' | 'grab'
  } | null = null

  private panelHandControlsPreview = false

  private voiceToggleEnabled = true

  constructor(private readonly options: ImmersiveSceneOptions) {
    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    })
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.xr.enabled = true
    configureImmersiveRenderQuality(this.renderer.xr)
    this.renderer.xr.setReferenceSpaceType('local-floor')
    this.timer.connect(document)
    this.scene.background = new Color('#01040a')
    this.camera.position.set(0, 1.65, 2.4)
    this.camera.lookAt(0, 1.65, 0)
    this.scene.add(this.world)
    this.createRoom()
    this.world.add(
      this.agentLight.group,
      this.transcriptView.group,
      this.controls.group,
      this.status.group,
      this.contrast.group
    )
    this.scene.add(this.statusWindow.group, this.statusWindow.menuGroup)
    this.setWorldCenter(new Vector3(0, 1.65, 0))

    this.interaction = new ImmersiveInteractionSystem({
      renderer: this.renderer,
      root: this.scene,
      getPanels: () => this.panels,
      getControlTargets: () => resolveWorldControlTargets(
        this.voiceToggleEnabled,
        this.agentLight.hitTarget,
        this.controls.hitTargets
      ),
      getStatusTargets: () => this.statusWindow.actionHits,
      getStatusMenuTarget: () => this.statusWindow.menuHit,
      isStatusOpen: () => this.statusWindow.isOpen,
      isStatusFullyOpen: () => this.statusWindow.isFullyOpen,
      getStatusInvocation: () => this.statusInvocation,
      onScroll: options.onPanelScroll,
      onPanelInteracted: options.onPanelInteracted,
      onPanelMoved: options.onPanelMoved,
      onPanelFocused: options.onPanelFocused,
      onPanelDismiss: options.onPanelDismiss,
      onAction: options.onAction,
      onStatusToggle: invocation => this.toggleStatusWindow(invocation),
      onStatusDismiss: () => this.closeStatusWindow(),
      onStatusAction: (action) => {
        this.closeStatusWindow()
        options.onStatusAction(action)
      },
      onStatusPressedChanged: action => {
        this.statusWindow.setPressedAction(action)
      },
      onInputCapabilitiesChanged: ({ fallbackMenu }) => {
        this.statusWindow.setMenuVisible(fallbackMenu)
        options.onStatusFallbackChanged(fallbackMenu)
      }
    })
    this.renderer.setAnimationLoop((timestamp) => {
      this.renderFrame(timestamp)
    })
    this.resize()
  }

  private createRoom() {
    this.world.add(this.room)
    const floorMaterial = new MeshBasicMaterial({
      color: '#040a12',
      transparent: true,
      opacity: 0.94
    })
    const floor = new Mesh(
      new PlaneGeometry(ROOM_SIZE_METERS, ROOM_SIZE_METERS),
      floorMaterial
    )
    floor.rotation.x = -Math.PI / 2
    floor.name = 'room-floor'
    this.room.add(floor)

    const grid = new GridHelper(
      ROOM_SIZE_METERS,
      20,
      '#10314a',
      '#071927'
    )
    grid.material.transparent = true
    grid.material.opacity = 0.18
    grid.position.y = 0.002
    this.room.add(grid)
    this.scene.add(new AmbientLight('#173449', 0.16))

    const wallMaterial = new MeshBasicMaterial({
      color: '#020710',
      side: 2,
      transparent: true,
      opacity: 0.84
    })
    const wallGeometry = new PlaneGeometry(ROOM_SIZE_METERS, 3.6)
    const back = new Mesh(wallGeometry, wallMaterial)
    back.position.set(0, 1.8, -ROOM_SIZE_METERS / 2)
    const front = new Mesh(wallGeometry.clone(), wallMaterial.clone())
    front.position.set(0, 1.8, ROOM_SIZE_METERS / 2)
    front.rotation.y = Math.PI
    const left = new Mesh(wallGeometry.clone(), wallMaterial.clone())
    left.position.set(-ROOM_SIZE_METERS / 2, 1.8, 0)
    left.rotation.y = Math.PI / 2
    const right = new Mesh(wallGeometry.clone(), wallMaterial.clone())
    right.position.set(ROOM_SIZE_METERS / 2, 1.8, 0)
    right.rotation.y = -Math.PI / 2
    configureRoomSurfaceRendering(floor, grid, [back, front, left, right])
    this.room.add(back, front, left, right)
  }

  private setWorldCenter(
    center: Vector3,
    forward: Vector3 = worldForward
  ) {
    worldCenter.copy(center)
    worldForward.copy(forward)
    worldForward.y = 0
    if (worldForward.lengthSq() < 0.001) {
      worldForward.set(0, 0, -1)
    } else {
      worldForward.normalize()
    }
    this.world.position.set(center.x, 0, center.z)
    this.world.quaternion.setFromUnitVectors(
      new Vector3(0, 0, -1),
      worldForward
    )
    worldCenter.set(0, center.y, 0)
    this.agentLight.group.position.copy(worldCenter)
    this.transcriptView.group.position.set(
      0,
      center.y + 0.72,
      0
    )
    this.controls.placeExitDoor(worldCenter, new Vector3(0, 0, -1))
    this.status.group.position.set(
      0,
      center.y + 1.22,
      0
    )
    floorCenter.set(0, 0, 0)
    this.room.position.copy(floorCenter)
    this.contrast.group.position.copy(this.agentLight.group.position)
  }

  private placeFromInitialViewer() {
    if (this.placedFromViewer || !this.renderer.xr.isPresenting) {
      return
    }
    const xrCamera = this.renderer.xr.getCamera()
    xrCamera.getWorldPosition(viewerPosition)
    xrCamera.getWorldDirection(viewerDirection)
    viewerDirection.y = 0
    if (viewerDirection.lengthSq() < 0.001) {
      viewerDirection.set(0, 0, -1)
    } else {
      viewerDirection.normalize()
    }
    const anchor = resolveWorkspaceAnchor({
      viewerPosition,
      viewerDirection,
      distanceMeters: INITIAL_LIGHT_DISTANCE_METERS,
      minimumHeightMeters: MIN_LIGHT_HEIGHT_METERS,
      maximumHeightMeters: MAX_LIGHT_HEIGHT_METERS
    })
    this.setWorldCenter(anchor.position, anchor.forward)
    this.placedFromViewer = true
    this.syncPanelViews()
  }

  setActivity(activity: RealtimeVisualActivity) {
    this.activity = activity
  }

  setVoiceToggleEnabled(enabled: boolean) {
    this.voiceToggleEnabled = enabled
    this.agentLight.hitTarget.visible = enabled
  }

  prepareAgentAwakening() {
    this.lightAnimator.enterDormant()
  }

  awakenAgent() {
    this.lightAnimator.awaken(this.animationTimeSeconds)
  }

  setTranscript(
    segments: readonly TranscriptBubbleSegment[],
    generation: number
  ) {
    this.transcriptSegments = [...segments]
    this.transcriptGeneration = generation
  }

  setPanels(panels: readonly SpatialPanelSnapshot[]) {
    this.panelSnapshots = [...panels]
    this.syncPanelViews()
  }

  setStatus(message: string, error = false) {
    this.status.update(message, error)
    if (error) {
      this.setActivity('error')
    }
  }

  setStatusWindowSnapshot(snapshot: StatusWindowSnapshot) {
    this.statusWindow.setSnapshot(snapshot)
  }

  private toggleStatusWindow(invocation: StatusWindowInvocation) {
    if (this.statusWindow.toggle(performance.now())) {
      if (this.statusWindow.isOpen) {
        this.statusAnchorTracker.reset()
        this.statusInvocation = invocation
        this.options.onStatusOpened()
      } else {
        this.statusInvocation = null
        this.options.onStatusClosed()
      }
    }
  }

  toggleStatusFromFallback() {
    this.toggleStatusWindow('fallback')
  }

  openStatusForPreview() {
    if (!this.statusWindow.isOpen) {
      this.toggleStatusWindow('fallback')
    }
  }

  private closeStatusWindow() {
    if (this.statusWindow.close(performance.now())) {
      this.statusAnchorTracker.reset()
      this.statusInvocation = null
      this.options.onStatusClosed()
    }
  }

  recenterWorkspace() {
    const camera = this.renderer.xr.isPresenting
      ? this.renderer.xr.getCamera()
      : this.camera
    camera.getWorldPosition(viewerPosition)
    camera.getWorldDirection(viewerDirection)
    viewerDirection.y = 0
    if (viewerDirection.lengthSq() < 0.001) {
      viewerDirection.set(0, 0, -1)
    } else {
      viewerDirection.normalize()
    }
    const anchor = resolveWorkspaceAnchor({
      viewerPosition,
      viewerDirection,
      distanceMeters: INITIAL_LIGHT_DISTANCE_METERS,
      minimumHeightMeters: MIN_LIGHT_HEIGHT_METERS,
      maximumHeightMeters: MAX_LIGHT_HEIGHT_METERS
    })
    this.setWorldCenter(anchor.position, anchor.forward)
    this.syncPanelViews()
  }

  setSessionVisualMode(
    mode: ImmersiveSessionMode,
    environmentBlendMode: XREnvironmentBlendMode
  ) {
    this.sessionMode = mode
    this.environmentBlendMode = environmentBlendMode
    const passthrough = mode === 'immersive-ar'
      && environmentBlendMode !== 'opaque'
    this.room.visible = !passthrough
    this.controls.group.visible = !passthrough
    this.scene.background = passthrough ? null : new Color('#01040a')
    this.renderer.setClearColor(0x000000, passthrough ? 0 : 1)
    this.contrast.setBlendMode(
      passthrough ? environmentBlendMode : 'opaque'
    )
  }

  private syncPanelViews() {
    const layoutNow = performance.now()
    let appearedPanelCount = 0
    const liveIds = new Set(this.panelSnapshots.map(panel => panel.id))
    for (const [id, view] of this.panels.entries()) {
      if (!liveIds.has(id)) {
        view.dispose()
        view.group.removeFromParent()
        this.panels.delete(id)
      }
    }

    const placements = allocatePanelSlots(this.panelSnapshots, {
      x: 0,
      y: 0,
      z: 0
    })
    const placementById = new Map(
      placements.map(placement => [placement.id, placement])
    )
    for (const snapshot of this.panelSnapshots) {
      const placement = placementById.get(snapshot.id)
      if (!placement || placement.overflow) {
        const existing = this.panels.get(snapshot.id)
        if (existing) {
          existing.group.visible = false
        }
        continue
      }
      let view = this.panels.get(snapshot.id)
      if (!view) {
        view = new SpatialPanelView(snapshot)
        this.panels.set(snapshot.id, view)
        this.world.add(view.group)
        appearedPanelCount += 1
      }
      view.group.visible = true
      view.update(snapshot)
      view.placeInSlot(
        snapshot.position
          ? snapshot.position
          : placement.position,
        layoutNow
      )
    }
    if (appearedPanelCount > 0) {
      this.options.onPanelAppeared(appearedPanelCount)
    }
  }

  setPanelInteractionPreview(
    panelId: string,
    state: 'idle' | 'active' | 'hover' | 'grab'
  ) {
    this.panelInteractionPreview = { panelId, state }
    this.applyPanelInteractionPreview()
  }

  private applyPanelInteractionPreview() {
    const preview = this.panelInteractionPreview
    if (!preview) {
      return
    }
    for (const [id, panel] of this.panels) {
      if (this.panelHandControlsPreview) {
        panel.setHandControlsVisible(true)
      }
      panel.setInteraction(
        id === preview.panelId
          && (preview.state === 'hover' || preview.state === 'grab'),
        id === preview.panelId && preview.state === 'grab',
        id === preview.panelId && preview.state !== 'idle'
      )
    }
  }

  setPanelHandControlsPreview(visible: boolean) {
    this.panelHandControlsPreview = visible
    this.applyPanelInteractionPreview()
  }

  setHandOutlinePreview(visible: boolean) {
    if (!visible) {
      for (const hand of this.developmentHands) {
        hand.group.visible = false
      }
      return
    }
    if (this.developmentHands.length === 0) {
      for (const [index, handedness] of (['left', 'right'] as const).entries()) {
        const hand = new HandOutlineView(handedness)
        hand.update(createDevelopmentHandPose(handedness))
        hand.group.position.set(index === 0 ? -0.52 : 0.52, 1.28, 0.22)
        hand.group.rotation.set(-0.35, index === 0 ? -0.18 : 0.18, 0)
        this.world.add(hand.group)
        this.developmentHands.push(hand)
      }
      return
    }
    for (const hand of this.developmentHands) {
      hand.group.visible = true
    }
  }

  resize() {
    const width = Math.max(1, this.options.canvas.clientWidth || window.innerWidth)
    const height = Math.max(1, this.options.canvas.clientHeight || window.innerHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  async setSession(
    session: XRSession | null,
    mode: ImmersiveSessionMode = 'immersive-vr'
  ) {
    this.releaseReferenceReset?.()
    this.releaseReferenceReset = null
    if (session) {
      this.placedFromViewer = false
      this.lightAnimator.enterDormant()
    } else {
      this.lightAnimator.resetAwakening()
    }
    await this.renderer.xr.setSession(session)
    if (session) {
      this.setSessionVisualMode(mode, session.environmentBlendMode)
      const referenceSpace = this.renderer.xr.getReferenceSpace()
      if (referenceSpace) {
        const handleReset = () => {
          this.referenceReset.mark()
        }
        referenceSpace.addEventListener('reset', handleReset)
        this.releaseReferenceReset = () => {
          referenceSpace.removeEventListener('reset', handleReset)
        }
      }
    } else {
      this.setSessionVisualMode('immersive-vr', 'opaque')
    }
  }

  private renderFrame(timestamp: number) {
    if (this.disposed) {
      return
    }
    this.timer.update(timestamp)
    const timeSeconds = this.timer.getElapsed()
    this.animationTimeSeconds = timeSeconds
    const deltaSeconds = Math.min(0.1, this.timer.getDelta())
    this.lightAnimator.setActivity(this.activity, timeSeconds)
    this.agentLight.update(
      this.lightAnimator.sample(
        timeSeconds,
        this.options.reducedEffects()
      ),
      timeSeconds
    )
    this.placeFromInitialViewer()
    if (this.referenceReset.take()) {
      this.recenterWorkspace()
    }

    const camera = this.renderer.xr.isPresenting
      ? this.renderer.xr.getCamera()
      : this.camera
    camera.getWorldPosition(viewerPosition)
    const now = performance.now()
    const anchor = this.interaction.statusAnchor()
    if (
      this.statusInvocation === 'hand'
      && this.statusWindow.group.visible
    ) {
      const trackedWrist = anchor
        ? anchor.getWorldPosition(statusAnchorPosition)
        : null
      const trackedPosition = this.statusAnchorTracker.update({
        wristPosition: trackedWrist,
        selectionEngaged: this.interaction.isStatusHandEngaged(),
        deltaSeconds
      })
      if (trackedPosition) {
        this.statusWindow.group.position.copy(trackedPosition)
      } else {
        this.statusWindow.group.position.copy(fallbackStatusOffset)
          .applyQuaternion(camera.quaternion)
          .add(viewerPosition)
      }
      const statusTarget = viewerFacingQuaternion(
        this.statusWindow.group.position,
        viewerPosition
      )
      smoothViewerFacingQuaternion(
        this.statusWindow.group.quaternion,
        statusTarget,
        deltaSeconds
      )
    } else if (anchor && this.statusWindow.group.visible) {
      anchor.getWorldPosition(statusAnchorPosition)
      resolveStatusWindowAnchorPosition(
        statusAnchorPosition,
        viewerPosition,
        this.statusWindow.group.position
      )
      const statusTarget = viewerFacingQuaternion(
        this.statusWindow.group.position,
        viewerPosition
      )
      smoothViewerFacingQuaternion(
        this.statusWindow.group.quaternion,
        statusTarget,
        deltaSeconds
      )
    } else if (this.statusWindow.group.visible) {
      this.statusWindow.group.position.copy(fallbackStatusOffset)
        .applyQuaternion(camera.quaternion)
        .add(viewerPosition)
      const fallbackTarget = viewerFacingQuaternion(
        this.statusWindow.group.position,
        viewerPosition
      )
      smoothViewerFacingQuaternion(
        this.statusWindow.group.quaternion,
        fallbackTarget,
        deltaSeconds
      )
    }
    menuWorldPosition.copy(menuOffset).applyQuaternion(camera.quaternion)
      .add(viewerPosition)
    this.statusWindow.menuGroup.position.copy(menuWorldPosition)
    const menuTarget = viewerFacingQuaternion(
      this.statusWindow.menuGroup.position,
      viewerPosition
    )
    this.statusWindow.menuGroup.quaternion.copy(menuTarget)
    this.statusWindow.update(now, this.options.reducedEffects())
    this.transcriptView.update(
      this.transcriptModel.update(
        this.transcriptSegments,
        this.transcriptGeneration,
        now
      ),
      now
    )
    smoothViewerFacingQuaternion(
      this.transcriptView.group.quaternion,
      viewerFacingLocalQuaternion(this.transcriptView.group, viewerPosition),
      deltaSeconds
    )
    smoothViewerFacingQuaternion(
      this.controls.group.quaternion,
      viewerFacingLocalQuaternion(this.controls.group, viewerPosition),
      deltaSeconds
    )
    smoothViewerFacingQuaternion(
      this.status.group.quaternion,
      viewerFacingLocalQuaternion(this.status.group, viewerPosition),
      deltaSeconds
    )

    for (const view of this.panels.values()) {
      view.updateAnimation(now, this.options.reducedEffects())
      smoothViewerFacingQuaternion(
        view.group.quaternion,
        viewerFacingLocalQuaternion(view.group, viewerPosition),
        deltaSeconds
      )
    }
    this.interaction.update(now, deltaSeconds)
    this.applyPanelInteractionPreview()
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.renderer.setAnimationLoop(null)
    this.timer.dispose()
    this.interaction.dispose()
    this.releaseReferenceReset?.()
    this.releaseReferenceReset = null
    for (const view of this.panels.values()) {
      view.dispose()
    }
    this.panels.clear()
    this.transcriptView.dispose()
    this.controls.dispose()
    this.status.dispose()
    this.statusWindow.dispose()
    this.agentLight.dispose()
    this.contrast.dispose()
    for (const hand of this.developmentHands) {
      hand.dispose()
    }
    this.developmentHands.length = 0
    this.scene.traverse((object) => {
      if (
        object instanceof Mesh
        || object instanceof LineSegments
      ) {
        object.geometry.dispose()
        if (Array.isArray(object.material)) {
          object.material.forEach(material => material.dispose())
        } else {
          object.material.dispose()
        }
      }
    })
    this.scene.clear()
    this.renderer.dispose()
  }
}

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

export type ImmersiveSceneOptions = {
  canvas: HTMLCanvasElement
  reducedEffects: () => boolean
  onAction: (action: WorldControlAction) => void
  onPanelScroll: (panelId: string, deltaLines: number) => void
  onPanelInteracted: (panelId: string) => void
  onPanelMoved: (panelId: string, position: Vector3) => void
  onPanelFocused: (panelId: string, position: Vector3) => void
  onPanelDismiss: (panelId: string) => void
}

const viewerPosition = new Vector3()
const viewerDirection = new Vector3()
const worldCenter = new Vector3(0, 1.65, 0)
const worldForward = new Vector3(0, 0, -1)
const floorCenter = new Vector3()

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value))

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

  private readonly panels = new Map<string, SpatialPanelView>()

  private readonly interaction: ImmersiveInteractionSystem

  private activity: RealtimeVisualActivity = 'idle'

  private animationTimeSeconds = 0

  private transcriptSegments: TranscriptBubbleSegment[] = []

  private transcriptGeneration = 0

  private panelSnapshots: SpatialPanelSnapshot[] = []

  private placedFromViewer = false

  private disposed = false

  constructor(private readonly options: ImmersiveSceneOptions) {
    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: false,
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
      this.status.group
    )
    this.setWorldCenter(new Vector3(0, 1.65, 0))

    this.interaction = new ImmersiveInteractionSystem({
      renderer: this.renderer,
      root: this.scene,
      getPanels: () => this.panels,
      getControlTargets: () => [
        this.agentLight.hitTarget,
        ...this.controls.hitTargets
      ],
      onScroll: options.onPanelScroll,
      onPanelInteracted: options.onPanelInteracted,
      onPanelMoved: options.onPanelMoved,
      onPanelFocused: options.onPanelFocused,
      onPanelDismiss: options.onPanelDismiss,
      onAction: options.onAction
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
    this.agentLight.group.position.copy(center)
    this.transcriptView.group.position.set(
      center.x,
      center.y + 0.72,
      center.z
    )
    this.controls.placeExitDoor(center, worldForward)
    this.status.group.position.set(
      center.x,
      center.y + 1.22,
      center.z
    )
    floorCenter.set(center.x, 0, center.z)
    this.room.position.copy(floorCenter)
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
    const center = viewerPosition.clone()
      .addScaledVector(viewerDirection, INITIAL_LIGHT_DISTANCE_METERS)
    center.y = clamp(
      viewerPosition.y,
      MIN_LIGHT_HEIGHT_METERS,
      MAX_LIGHT_HEIGHT_METERS
    )
    this.setWorldCenter(center, viewerDirection)
    this.placedFromViewer = true
    this.syncPanelViews()
  }

  setActivity(activity: RealtimeVisualActivity) {
    this.activity = activity
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

  private syncPanelViews() {
    const layoutNow = performance.now()
    const liveIds = new Set(this.panelSnapshots.map(panel => panel.id))
    for (const [id, view] of this.panels.entries()) {
      if (!liveIds.has(id)) {
        view.dispose()
        view.group.removeFromParent()
        this.panels.delete(id)
      }
    }

    const placements = allocatePanelSlots(this.panelSnapshots, {
      x: worldCenter.x,
      y: 0,
      z: worldCenter.z
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
      }
      view.group.visible = true
      view.update(snapshot)
      view.placeInSlot(
        snapshot.userMoved && snapshot.position
          ? snapshot.position
          : placement.position,
        layoutNow
      )
    }
  }

  resize() {
    const width = Math.max(1, this.options.canvas.clientWidth || window.innerWidth)
    const height = Math.max(1, this.options.canvas.clientHeight || window.innerHeight)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height, false)
  }

  async setSession(session: XRSession | null) {
    if (session) {
      this.placedFromViewer = false
      this.lightAnimator.enterDormant()
    } else {
      this.lightAnimator.resetAwakening()
    }
    await this.renderer.xr.setSession(session)
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

    const camera = this.renderer.xr.isPresenting
      ? this.renderer.xr.getCamera()
      : this.camera
    camera.getWorldPosition(viewerPosition)
    const now = performance.now()
    this.transcriptView.update(
      this.transcriptModel.update(
        this.transcriptSegments,
        this.transcriptGeneration,
        now
      ),
      now
    )
    const bubbleTarget = viewerFacingQuaternion(
      this.transcriptView.group.position,
      viewerPosition
    )
    smoothViewerFacingQuaternion(
      this.transcriptView.group.quaternion,
      bubbleTarget,
      deltaSeconds
    )
    const controlsTarget = viewerFacingQuaternion(
      this.controls.group.position,
      viewerPosition
    )
    smoothViewerFacingQuaternion(
      this.controls.group.quaternion,
      controlsTarget,
      deltaSeconds
    )
    const statusTarget = viewerFacingQuaternion(
      this.status.group.position,
      viewerPosition
    )
    smoothViewerFacingQuaternion(
      this.status.group.quaternion,
      statusTarget,
      deltaSeconds
    )

    for (const view of this.panels.values()) {
      view.updateAnimation(now)
      const target = viewerFacingQuaternion(
        view.group.position,
        viewerPosition
      )
      smoothViewerFacingQuaternion(
        view.group.quaternion,
        target,
        deltaSeconds
      )
    }
    this.interaction.update(now)
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
    for (const view of this.panels.values()) {
      view.dispose()
    }
    this.panels.clear()
    this.transcriptView.dispose()
    this.controls.dispose()
    this.status.dispose()
    this.agentLight.dispose()
    this.scene.traverse((object) => {
      if (object instanceof Mesh || object instanceof LineSegments) {
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

import {
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Vector3
} from 'three'
import {
  EXIT_DOOR_FORWARD_OFFSET_METERS,
  EXIT_DOOR_HEIGHT_METERS,
  EXIT_DOOR_WALL_OFFSET_METERS,
  EXIT_DOOR_WIDTH_METERS,
  ROOM_SIZE_METERS
} from './config'
import { CanvasTextSurface } from './text-surface'

export type WorldControlAction = 'toggle-voice' | 'exit-xr'

const fallbackForward = new Vector3(0, 0, -1)

export const resolveExitDoorPosition = (
  roomCenter: Vector3,
  forward: Vector3,
  roomSizeMeters = ROOM_SIZE_METERS
) => {
  const direction = forward.clone()
  direction.y = 0
  if (direction.lengthSq() < 0.001) {
    direction.copy(fallbackForward)
  } else {
    direction.normalize()
  }
  const halfExtent = Math.max(
    0,
    (roomSizeMeters / 2) - EXIT_DOOR_WALL_OFFSET_METERS
  )
  const right = new Vector3(
    -direction.z,
    0,
    direction.x
  )
  const position = roomCenter.clone()
  const inset = EXIT_DOOR_WIDTH_METERS / 2
  if (Math.abs(right.x) >= Math.abs(right.z)) {
    position.x = roomCenter.x + (
      Math.sign(right.x || 1) * halfExtent
    )
    position.z = Math.min(
      roomCenter.z + halfExtent - inset,
      Math.max(
        roomCenter.z - halfExtent + inset,
        roomCenter.z + (
          direction.z * EXIT_DOOR_FORWARD_OFFSET_METERS
        )
      )
    )
  } else {
    position.z = roomCenter.z + (
      Math.sign(right.z || 1) * halfExtent
    )
    position.x = Math.min(
      roomCenter.x + halfExtent - inset,
      Math.max(
        roomCenter.x - halfExtent + inset,
        roomCenter.x + (
          direction.x * EXIT_DOOR_FORWARD_OFFSET_METERS
        )
      )
    )
  }
  return position.setY(EXIT_DOOR_HEIGHT_METERS / 2)
}

const createExitDoor = () => {
  const group = new Group()
  const surface = new CanvasTextSurface({
    widthMeters: EXIT_DOOR_WIDTH_METERS,
    heightMeters: EXIT_DOOR_HEIGHT_METERS,
    widthPixels: 960,
    heightPixels: 1_620,
    background: 'rgba(3, 16, 27, 0.72)',
    border: 'rgba(87, 220, 251, 0.82)',
    color: '#c7f5ff',
    font: 'Inter, system-ui, sans-serif',
    lineHeightPixels: 56,
    paddingPixels: 64,
    titleFontSizePixels: 84,
    glow: true
  })
  surface.render({
    title: 'Exit',
    body: ''
  })
  const hit = new Mesh(
    new BoxGeometry(
      EXIT_DOOR_WIDTH_METERS,
      EXIT_DOOR_HEIGHT_METERS,
      0.08
    ),
    new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
  )
  hit.name = 'exit-door-hit-target'
  hit.userData.action = 'exit-xr' satisfies WorldControlAction
  hit.position.z = 0.01
  group.name = 'exit-door'
  group.add(surface.mesh, hit)
  return {
    group,
    hit,
    surface,
    dispose: () => {
      surface.dispose()
      hit.geometry.dispose()
      hit.material.dispose()
      group.clear()
    }
  }
}

export class WorldControls {
  readonly group = new Group()

  readonly hitTargets: Mesh[] = []

  private readonly exit = createExitDoor()

  constructor() {
    this.group.name = 'world-controls'
    this.group.add(this.exit.group)
    this.hitTargets.push(this.exit.hit)
  }

  placeExitDoor(roomCenter: Vector3, forward: Vector3) {
    this.group.position.copy(
      resolveExitDoorPosition(roomCenter, forward)
    )
  }

  dispose() {
    this.exit.dispose()
    this.hitTargets.length = 0
    this.group.clear()
  }
}

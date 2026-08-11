import { Vector3 } from 'three'

export const STATUS_WINDOW_DISTANCE_METERS = 0.4
export const STATUS_WINDOW_WRIST_RISE_METERS = 0.18

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

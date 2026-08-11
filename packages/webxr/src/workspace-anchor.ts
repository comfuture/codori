import { Quaternion, Vector3 } from 'three'

export type WorkspaceAnchor = {
  position: Vector3
  forward: Vector3
  rotation: Quaternion
}

export const resolveWorkspaceAnchor = (input: {
  viewerPosition: Vector3
  viewerDirection: Vector3
  distanceMeters: number
  minimumHeightMeters: number
  maximumHeightMeters: number
}): WorkspaceAnchor => {
  const forward = input.viewerDirection.clone().setY(0)
  if (forward.lengthSq() < 0.001) {
    forward.set(0, 0, -1)
  } else {
    forward.normalize()
  }
  const position = input.viewerPosition.clone()
    .addScaledVector(forward, input.distanceMeters)
  position.y = Math.min(
    input.maximumHeightMeters,
    Math.max(input.minimumHeightMeters, input.viewerPosition.y)
  )
  const rotation = new Quaternion().setFromUnitVectors(
    new Vector3(0, 0, -1),
    forward
  )
  return { position, forward, rotation }
}

export const anchoredWorldPosition = (
  anchor: Vector3,
  local: Vector3,
  rotation = new Quaternion()
) => local.clone().applyQuaternion(rotation).add(anchor)

export class ReferenceSpaceResetModel {
  private pending = false

  mark() {
    this.pending = true
  }

  take() {
    const pending = this.pending
    this.pending = false
    return pending
  }
}

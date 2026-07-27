import { Matrix4, Quaternion, Vector3 } from 'three'

const lookAtMatrix = new Matrix4()
const targetQuaternion = new Quaternion()
const worldUp = new Vector3(0, 1, 0)

export const viewerFacingQuaternion = (
  objectPosition: Vector3,
  viewerPosition: Vector3
) => {
  lookAtMatrix.lookAt(viewerPosition, objectPosition, worldUp)
  return targetQuaternion.setFromRotationMatrix(lookAtMatrix)
}

export const smoothViewerFacingQuaternion = (
  current: Quaternion,
  target: Quaternion,
  deltaSeconds: number,
  damping = 12,
  snapAngleRadians = Math.PI * 0.68
) => {
  const angle = current.angleTo(target)
  if (angle >= snapAngleRadians) {
    return current.copy(target)
  }
  const progress = 1 - Math.exp(-Math.max(0, damping) * Math.max(0, deltaSeconds))
  return current.slerp(target, progress)
}

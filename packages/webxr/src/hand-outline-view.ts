import {
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type XRHandSpace
} from 'three'

export const HAND_JOINT_NAMES: readonly XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip'
] as const

export const HAND_BONE_CONNECTIONS: readonly (
  readonly [XRHandJoint, XRHandJoint]
)[] = [
  ['wrist', 'thumb-metacarpal'],
  ['thumb-metacarpal', 'thumb-phalanx-proximal'],
  ['thumb-phalanx-proximal', 'thumb-phalanx-distal'],
  ['thumb-phalanx-distal', 'thumb-tip'],
  ['wrist', 'index-finger-metacarpal'],
  ['index-finger-metacarpal', 'index-finger-phalanx-proximal'],
  ['index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate'],
  ['index-finger-phalanx-intermediate', 'index-finger-phalanx-distal'],
  ['index-finger-phalanx-distal', 'index-finger-tip'],
  ['wrist', 'middle-finger-metacarpal'],
  ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal'],
  ['middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate'],
  ['middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal'],
  ['middle-finger-phalanx-distal', 'middle-finger-tip'],
  ['wrist', 'ring-finger-metacarpal'],
  ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal'],
  ['ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate'],
  ['ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal'],
  ['ring-finger-phalanx-distal', 'ring-finger-tip'],
  ['wrist', 'pinky-finger-metacarpal'],
  ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal'],
  ['pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate'],
  ['pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal'],
  ['pinky-finger-phalanx-distal', 'pinky-finger-tip'],
  ['thumb-metacarpal', 'index-finger-metacarpal'],
  ['index-finger-metacarpal', 'middle-finger-metacarpal'],
  ['middle-finger-metacarpal', 'ring-finger-metacarpal'],
  ['ring-finger-metacarpal', 'pinky-finger-metacarpal']
] as const

export type HandOutlineJointPose = {
  position: Vector3
  radius: number
}

export type HandOutlinePose = ReadonlyMap<XRHandJoint, HandOutlineJointPose>

const yAxis = new Vector3(0, 1, 0)
const midpoint = new Vector3()
const direction = new Vector3()
const scale = new Vector3()
const rotation = new Quaternion()
const matrix = new Matrix4()

const handColor = (handedness: XRHandedness) => handedness === 'left'
  ? '#a8efff'
  : '#d8ffad'

export const resolveHandJointRadius = (radius?: number) =>
  Math.max(0.001, radius ?? 0.006)

export class HandOutlineView {
  readonly group = new Group()

  readonly outerBones: InstancedMesh

  readonly innerBones: InstancedMesh

  readonly outerJoints: InstancedMesh

  readonly innerJoints: InstancedMesh

  private readonly boneGeometry = new CylinderGeometry(1, 1, 1, 8, 1, true)

  private readonly jointGeometry = new SphereGeometry(1, 10, 7)

  private readonly outerMaterial = new MeshBasicMaterial({
    color: '#061116',
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    depthTest: true,
    toneMapped: false
  })

  private readonly innerMaterial = new MeshBasicMaterial({
    color: '#d8ffad',
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    depthTest: true,
    toneMapped: false
  })

  private readonly trackedPose = new Map<XRHandJoint, HandOutlineJointPose>()

  private currentHandedness: XRHandedness

  constructor(handedness: XRHandedness = 'none') {
    this.currentHandedness = handedness
    const boneCapacity = HAND_BONE_CONNECTIONS.length
    const jointCapacity = HAND_JOINT_NAMES.length
    this.outerBones = new InstancedMesh(
      this.boneGeometry,
      this.outerMaterial,
      boneCapacity
    )
    this.innerBones = new InstancedMesh(
      this.boneGeometry,
      this.innerMaterial,
      boneCapacity
    )
    this.outerJoints = new InstancedMesh(
      this.jointGeometry,
      this.outerMaterial,
      jointCapacity
    )
    this.innerJoints = new InstancedMesh(
      this.jointGeometry,
      this.innerMaterial,
      jointCapacity
    )
    this.group.name = `tracked-hand-outline-${handedness}`
    this.group.userData.representationalOnly = true
    this.innerMaterial.color.set(handColor(handedness))
    for (const object of [
      this.outerBones,
      this.innerBones,
      this.outerJoints,
      this.innerJoints
    ]) {
      object.frustumCulled = false
      object.userData.representationalOnly = true
      object.raycast = () => {}
    }
    this.outerBones.renderOrder = 20
    this.outerJoints.renderOrder = 20
    this.innerBones.renderOrder = 21
    this.innerJoints.renderOrder = 21
    this.group.add(
      this.outerBones,
      this.outerJoints,
      this.innerBones,
      this.innerJoints
    )
    this.clear()
  }

  get handedness() {
    return this.currentHandedness
  }

  setHandedness(handedness: XRHandedness) {
    this.currentHandedness = handedness
    this.group.name = `tracked-hand-outline-${handedness}`
    this.innerMaterial.color.set(handColor(handedness))
  }

  updateFromHand(hand: XRHandSpace, allowed: boolean) {
    this.trackedPose.clear()
    if (allowed && hand.visible) {
      for (const name of HAND_JOINT_NAMES) {
        const joint = hand.joints[name]
        if (!joint?.visible) {
          continue
        }
        this.trackedPose.set(name, {
          position: joint.position,
          radius: resolveHandJointRadius(joint.jointRadius)
        })
      }
    }
    this.update(this.trackedPose, allowed)
  }

  update(pose: HandOutlinePose, allowed = true) {
    let boneCount = 0
    for (const [fromName, toName] of HAND_BONE_CONNECTIONS) {
      const from = pose.get(fromName)
      const to = pose.get(toName)
      if (!from || !to) {
        continue
      }
      direction.subVectors(to.position, from.position)
      const length = direction.length()
      if (length < 0.0001) {
        continue
      }
      midpoint.copy(from.position).add(to.position).multiplyScalar(0.5)
      rotation.setFromUnitVectors(yAxis, direction.divideScalar(length))
      const trackedRadius = Math.min(0.007, (from.radius + to.radius) * 0.18)
      scale.set(trackedRadius * 1.75, length, trackedRadius * 1.75)
      matrix.compose(midpoint, rotation, scale)
      this.outerBones.setMatrixAt(boneCount, matrix)
      scale.x = trackedRadius
      scale.z = trackedRadius
      matrix.compose(midpoint, rotation, scale)
      this.innerBones.setMatrixAt(boneCount, matrix)
      boneCount += 1
    }

    let jointCount = 0
    for (const name of HAND_JOINT_NAMES) {
      const joint = pose.get(name)
      if (!joint) {
        continue
      }
      const radius = Math.max(0.003, joint.radius)
      // The outer translucent surface matches the WebXR joint radius used by
      // direct-touch collision so visible fingertip contact and activation
      // share one physical boundary.
      scale.setScalar(radius)
      matrix.compose(joint.position, rotation.identity(), scale)
      this.outerJoints.setMatrixAt(jointCount, matrix)
      scale.setScalar(radius * 0.58)
      matrix.compose(joint.position, rotation, scale)
      this.innerJoints.setMatrixAt(jointCount, matrix)
      jointCount += 1
    }

    this.outerBones.count = boneCount
    this.innerBones.count = boneCount
    this.outerJoints.count = jointCount
    this.innerJoints.count = jointCount
    for (const mesh of [
      this.outerBones,
      this.innerBones,
      this.outerJoints,
      this.innerJoints
    ]) {
      mesh.instanceMatrix.needsUpdate = true
    }
    this.group.visible = allowed && boneCount >= 4 && jointCount >= 5
  }

  clear() {
    this.outerBones.count = 0
    this.innerBones.count = 0
    this.outerJoints.count = 0
    this.innerJoints.count = 0
    this.group.visible = false
  }

  dispose() {
    this.clear()
    this.group.removeFromParent()
    this.group.clear()
    this.boneGeometry.dispose()
    this.jointGeometry.dispose()
    this.outerMaterial.dispose()
    this.innerMaterial.dispose()
  }
}

export const createDevelopmentHandPose = (
  handedness: 'left' | 'right'
): Map<XRHandJoint, HandOutlineJointPose> => {
  const side = handedness === 'left' ? -1 : 1
  const pose = new Map<XRHandJoint, HandOutlineJointPose>()
  const set = (name: XRHandJoint, x: number, y: number, z: number, radius = 0.009) => {
    pose.set(name, { position: new Vector3(x * side, y, z), radius })
  }
  set('wrist', 0, -0.11, 0, 0.014)
  set('thumb-metacarpal', 0.025, -0.055, 0.004, 0.011)
  set('thumb-phalanx-proximal', 0.055, -0.025, 0.008)
  set('thumb-phalanx-distal', 0.075, 0.005, 0.006)
  set('thumb-tip', 0.085, 0.035, 0.004, 0.007)
  const fingers = [
    ['index', 0.035, 0.105],
    ['middle', 0.012, 0.125],
    ['ring', -0.014, 0.116],
    ['pinky', -0.038, 0.09]
  ] as const
  for (const [finger, x, length] of fingers) {
    set(`${finger}-finger-metacarpal` as XRHandJoint, x, -0.035, 0, 0.01)
    set(`${finger}-finger-phalanx-proximal` as XRHandJoint, x, 0.005, 0, 0.009)
    set(`${finger}-finger-phalanx-intermediate` as XRHandJoint, x, length * 0.42, -0.004, 0.008)
    set(`${finger}-finger-phalanx-distal` as XRHandJoint, x, length * 0.72, -0.008, 0.007)
    set(`${finger}-finger-tip` as XRHandJoint, x, length, -0.012, 0.006)
  }
  return pose
}

import { describe, expect, it, vi } from 'vitest'
import {
  MeshBasicMaterial,
  Raycaster,
  Vector3
} from 'three'
import {
  createDevelopmentHandPose,
  HAND_BONE_CONNECTIONS,
  HAND_JOINT_NAMES,
  HandOutlineView
} from '../src/hand-outline-view'

describe('tracked hand outline', () => {
  it('renders a connected, handed joint silhouette without hit testing', () => {
    const view = new HandOutlineView('left')
    view.update(createDevelopmentHandPose('left'))

    expect(view.group.name).toBe('tracked-hand-outline-left')
    expect(view.group.visible).toBe(true)
    expect(view.innerBones.count).toBe(HAND_BONE_CONNECTIONS.length)
    expect(view.innerJoints.count).toBe(HAND_JOINT_NAMES.length)
    expect(view.outerBones.count).toBe(view.innerBones.count)
    expect(view.outerJoints.count).toBe(view.innerJoints.count)

    const inner = view.innerBones.material as MeshBasicMaterial
    const outer = view.outerBones.material as MeshBasicMaterial
    expect(inner).toMatchObject({
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
      depthTest: true,
      toneMapped: false
    })
    expect(outer.opacity).toBeLessThan(inner.opacity)
    expect(inner.color.getHexString()).toBe('a8efff')
    expect(view.group.userData.representationalOnly).toBe(true)

    view.group.updateMatrixWorld(true)
    const raycaster = new Raycaster(
      new Vector3(0, 0, 1),
      new Vector3(0, 0, -1)
    )
    expect(raycaster.intersectObject(view.group, true)).toHaveLength(0)
    view.dispose()
  })

  it('updates handedness and hides cleanly when tracking is unavailable', () => {
    const view = new HandOutlineView()
    view.setHandedness('right')
    view.update(createDevelopmentHandPose('right'))
    expect(view.handedness).toBe('right')
    expect(view.group.name).toBe('tracked-hand-outline-right')
    expect(
      (view.innerBones.material as MeshBasicMaterial).color.getHexString()
    ).toBe('d8ffad')

    const disposeBoneGeometry = vi.spyOn(view.innerBones.geometry, 'dispose')
    const disposeJointGeometry = vi.spyOn(view.innerJoints.geometry, 'dispose')
    view.clear()
    expect(view.group.visible).toBe(false)
    expect(view.innerBones.count).toBe(0)
    expect(view.innerJoints.count).toBe(0)
    view.dispose()
    expect(disposeBoneGeometry).toHaveBeenCalledTimes(1)
    expect(disposeJointGeometry).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it } from 'vitest'
import { Group, Vector3 } from 'three'
import {
  viewerFacingLocalQuaternion,
  viewerFacingQuaternion
} from '../src/billboard'

describe('viewer-facing billboard', () => {
  it('points the front face toward the viewer', () => {
    const objectPosition = new Vector3(0.5, 1.4, -2)
    const viewerPosition = new Vector3(-0.25, 1.7, 0.3)
    const expectedDirection = viewerPosition.clone()
      .sub(objectPosition)
      .normalize()
    const frontDirection = new Vector3(0, 0, 1)
      .applyQuaternion(
        viewerFacingQuaternion(objectPosition, viewerPosition)
      )

    expect(frontDirection.dot(expectedDirection)).toBeCloseTo(1)
  })

  it('converts a world-facing target into child-local space under a 90-degree yaw', () => {
    const anchor = new Group()
    anchor.position.set(2, 0, -1)
    anchor.rotation.y = -Math.PI / 2
    const panel = new Group()
    panel.position.set(0.4, 1.4, -1.2)
    anchor.add(panel)
    anchor.updateMatrixWorld(true)
    const viewer = new Vector3(0, 1.65, 0)

    panel.quaternion.copy(viewerFacingLocalQuaternion(panel, viewer))
    anchor.updateMatrixWorld(true)
    const worldPosition = panel.getWorldPosition(new Vector3())
    const worldQuaternion = panel.getWorldQuaternion(panel.quaternion.clone())
    const front = new Vector3(0, 0, 1).applyQuaternion(worldQuaternion)
    const expected = viewer.clone().sub(worldPosition).normalize()
    expect(front.dot(expected)).toBeCloseTo(1)
  })
})

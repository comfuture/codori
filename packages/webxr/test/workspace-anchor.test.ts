import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  anchoredWorldPosition,
  ReferenceSpaceResetModel,
  resolveWorkspaceAnchor
} from '../src/workspace-anchor'

describe('XR workspace anchor', () => {
  it('recenters in horizontal gaze while clamping eye height', () => {
    const anchor = resolveWorkspaceAnchor({
      viewerPosition: new Vector3(2, 2.4, 3),
      viewerDirection: new Vector3(1, -0.4, -1),
      distanceMeters: 1.45,
      minimumHeightMeters: 1.1,
      maximumHeightMeters: 1.9
    })
    expect(anchor.position.y).toBe(1.9)
    expect(anchor.forward.y).toBe(0)
    expect(anchor.position.distanceTo(new Vector3(2, 1.9, 3))).toBeCloseTo(1.45)
  })

  it('rotates the workspace basis into a 90-degree gaze while preserving local transforms', () => {
    const anchor = resolveWorkspaceAnchor({
      viewerPosition: new Vector3(0, 1.65, 0),
      viewerDirection: new Vector3(1, 0, 0),
      distanceMeters: 1.5,
      minimumHeightMeters: 1,
      maximumHeightMeters: 2
    })
    const leftPane = anchoredWorldPosition(
      anchor.position,
      new Vector3(-0.5, 0, -0.4),
      anchor.rotation
    )
    const rightPane = anchoredWorldPosition(
      anchor.position,
      new Vector3(0.5, 0, -0.4),
      anchor.rotation
    )
    expect(anchor.forward).toEqual(new Vector3(1, 0, 0))
    expect(leftPane.distanceTo(rightPane)).toBeCloseTo(1)
    expect(leftPane.x).toBeCloseTo(rightPane.x)
    expect(leftPane.z).not.toBeCloseTo(rightPane.z)
  })

  it('moves every local pane by one anchor delta without changing identity or spacing', () => {
    const local = new Map([
      ['pane-a', new Vector3(-0.4, 1.3, -0.2)],
      ['pane-b', new Vector3(0.5, 1.6, -0.4)]
    ])
    const beforeAnchor = new Vector3(0, 0, 0)
    const afterAnchor = new Vector3(3, 0, -2)
    const before = [...local].map(([id, point]) => [id, anchoredWorldPosition(beforeAnchor, point)] as const)
    const after = [...local].map(([id, point]) => [id, anchoredWorldPosition(afterAnchor, point)] as const)
    expect(after.map(([id]) => id)).toEqual(before.map(([id]) => id))
    expect(after[0]![1].distanceTo(after[1]![1])).toBeCloseTo(
      before[0]![1].distanceTo(before[1]![1])
    )
  })

  it('coalesces a reference-space reset into exactly one recenter', () => {
    const reset = new ReferenceSpaceResetModel()
    reset.mark()
    reset.mark()
    expect(reset.take()).toBe(true)
    expect(reset.take()).toBe(false)
  })
})

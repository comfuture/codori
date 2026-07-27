import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { viewerFacingQuaternion } from '../src/billboard'

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
})

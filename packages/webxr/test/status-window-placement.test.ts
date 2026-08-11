import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  resolveStatusWindowAnchorPosition,
  STATUS_WINDOW_DISTANCE_METERS,
  STATUS_WINDOW_WRIST_RISE_METERS
} from '../src/status-window-placement'

describe('status window placement', () => {
  it('keeps the wrist-directed window forty centimeters from the viewer', () => {
    const viewer = new Vector3(0, 1.65, 0)
    const wrist = new Vector3(-0.22, 1.42, -0.34)
    const position = resolveStatusWindowAnchorPosition(wrist, viewer)
    expect(position.distanceTo(viewer)).toBeCloseTo(
      STATUS_WINDOW_DISTANCE_METERS
    )
    expect(position.x).toBeLessThan(0)
    expect(position.y).toBeCloseTo(1.65 + (
      (wrist.y + STATUS_WINDOW_WRIST_RISE_METERS - 1.65)
      / new Vector3(
        wrist.x,
        wrist.y + STATUS_WINDOW_WRIST_RISE_METERS - 1.65,
        wrist.z
      ).length()
      * STATUS_WINDOW_DISTANCE_METERS
    ))
  })

  it('continues following allowed lateral wrist movement', () => {
    const viewer = new Vector3(0, 1.65, 0)
    const first = resolveStatusWindowAnchorPosition(
      new Vector3(-0.18, 1.44, -0.34),
      viewer
    ).clone()
    const second = resolveStatusWindowAnchorPosition(
      new Vector3(-0.32, 1.44, -0.34),
      viewer
    ).clone()
    expect(second.x).toBeLessThan(first.x)
    expect(first.distanceTo(viewer)).toBeCloseTo(0.4)
    expect(second.distanceTo(viewer)).toBeCloseTo(0.4)
  })
})

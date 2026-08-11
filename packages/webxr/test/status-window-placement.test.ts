import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  resolveHandStatusWindowAnchorPosition,
  resolveStatusWindowAnchorPosition,
  StatusWindowAnchorTracker,
  STATUS_WINDOW_DISTANCE_METERS,
  STATUS_WINDOW_WRIST_RISE_METERS
} from '../src/status-window-placement'

describe('status window placement', () => {
  it('keeps controller placement forty centimeters from the viewer', () => {
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

  it('keeps hand placement attached to the physical wrist in all axes', () => {
    const firstWrist = new Vector3(-0.18, 1.44, -0.34)
    const secondWrist = new Vector3(-0.32, 1.5, -0.62)
    const first = resolveHandStatusWindowAnchorPosition(firstWrist).clone()
    const second = resolveHandStatusWindowAnchorPosition(secondWrist).clone()
    expect(first).toEqual(new Vector3(
      firstWrist.x,
      firstWrist.y + STATUS_WINDOW_WRIST_RISE_METERS,
      firstWrist.z
    ))
    expect(second).toEqual(new Vector3(
      secondWrist.x,
      secondWrist.y + STATUS_WINDOW_WRIST_RISE_METERS,
      secondWrist.z
    ))
    expect(second.z - first.z).toBeCloseTo(secondWrist.z - firstWrist.z)
  })

  it('freezes the last stable pose during right-hand approach and tracking loss', () => {
    const tracker = new StatusWindowAnchorTracker()
    const first = tracker.update({
      wristPosition: new Vector3(-0.18, 1.44, -0.34),
      selectionEngaged: false,
      deltaSeconds: 1 / 60
    })!.clone()
    const engaged = tracker.update({
      wristPosition: new Vector3(-0.28, 1.4, -0.3),
      selectionEngaged: true,
      deltaSeconds: 1 / 60
    })!.clone()
    const occluded = tracker.update({
      wristPosition: null,
      selectionEngaged: true,
      deltaSeconds: 1 / 60
    })!.clone()

    expect(engaged).toEqual(first)
    expect(occluded).toEqual(first)
  })

  it('rejects an implausible reacquisition jump but follows modest motion', () => {
    const tracker = new StatusWindowAnchorTracker()
    const first = tracker.update({
      wristPosition: new Vector3(-0.18, 1.44, -0.34),
      selectionEngaged: false,
      deltaSeconds: 1 / 60
    })!.clone()
    const jumped = tracker.update({
      wristPosition: new Vector3(0.45, 0.8, -0.05),
      selectionEngaged: false,
      deltaSeconds: 1 / 60
    })!.clone()
    const followed = tracker.update({
      wristPosition: new Vector3(-0.22, 1.43, -0.34),
      selectionEngaged: false,
      deltaSeconds: 1 / 30
    })!.clone()

    expect(jumped).toEqual(first)
    expect(followed.x).toBeLessThan(first.x)
  })

  it('reacquires a stable wrist pose after rejecting the initial jump', () => {
    const tracker = new StatusWindowAnchorTracker()
    const first = tracker.update({
      wristPosition: new Vector3(-0.18, 1.44, -0.34),
      selectionEngaged: false,
      deltaSeconds: 1 / 60
    })!.clone()
    const reacquiredWrist = new Vector3(0.2, 1.2, -0.5)

    for (let index = 0; index < 8; index += 1) {
      tracker.update({
        wristPosition: reacquiredWrist,
        selectionEngaged: false,
        deltaSeconds: 1 / 60
      })
    }
    const reacquired = tracker.update({
      wristPosition: reacquiredWrist,
      selectionEngaged: false,
      deltaSeconds: 1 / 60
    })!.clone()

    expect(reacquired.x).toBeGreaterThan(first.x)
    expect(reacquired.y).toBeLessThan(first.y)
  })
})

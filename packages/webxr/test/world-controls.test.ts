import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { resolveExitDoorPosition } from '../src/world-controls'

describe('world exit door placement', () => {
  it('places the door on the room boundary beyond the agent light', () => {
    const position = resolveExitDoorPosition(
      new Vector3(0, 1.65, -2.4),
      new Vector3(0, 0, -1)
    )

    expect(position.x).toBeCloseTo(4.965)
    expect(position.y).toBe(1.1)
    expect(position.z).toBeCloseTo(-3.75)
  })

  it('meets the square boundary for a diagonal initial view', () => {
    const center = new Vector3(0.4, 1.5, -1)
    const position = resolveExitDoorPosition(
      center,
      new Vector3(1, 0, -1)
    )
    const offset = position.clone().sub(center)

    expect(Math.max(Math.abs(offset.x), Math.abs(offset.z)))
      .toBeCloseTo(4.965)
    expect(Math.min(Math.abs(offset.x), Math.abs(offset.z)))
      .toBeGreaterThan(0.9)
  })
})

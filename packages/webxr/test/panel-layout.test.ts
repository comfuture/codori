import { describe, expect, it } from 'vitest'
import { allocatePanelSlots } from '../src/panel-layout'
import type { SpatialPanelSnapshot } from '../src/panel-model'

const snapshot = (id: string, background = false): SpatialPanelSnapshot => ({
  id,
  kind: background ? 'background-terminal' : 'command',
  title: id,
  status: 'in-progress',
  text: id,
  retainedText: id,
  truncated: false,
  background,
  phase: 'visible',
  phaseStartedAt: 0,
  scrollOffset: Number.POSITIVE_INFINITY,
  autoFollow: true,
  userMoved: false,
  slot: null
})

describe('panel slot allocation', () => {
  it('is deterministic, collision free, and reserves overflow', () => {
    const panels = Array.from({ length: 10 }, (_, index) =>
      snapshot(`panel-${index}`, index < 2)
    )
    const center = { x: 0, y: 0, z: -2.4 }
    const first = allocatePanelSlots(panels, center)
    const second = allocatePanelSlots([...panels].reverse(), center)

    expect(first).toEqual(second)
    const visible = first.filter(placement => !placement.overflow)
    expect(new Set(visible.map(placement => placement.slot)).size).toBe(8)
    expect(first.filter(placement => placement.overflow)).toHaveLength(2)
    expect(visible.every(placement => placement.position.y > 0)).toBe(true)
  })
})

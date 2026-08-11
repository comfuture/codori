import { describe, expect, it } from 'vitest'
import {
  allocatePanelSlots,
  assignNewPanelToFrontSlot
} from '../src/panel-layout'
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
  position: null,
  slot: null,
  fileTransitionStartedAt: 0
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
    expect(visible.every(placement =>
      Math.abs(placement.position.x - center.x) <= 1.55
    )).toBe(true)
  })

  it('keeps a new panel in front and displaces only the nearby occupant', () => {
    const panels = Array.from(
      { length: 4 },
      (_, index) => ({
        ...snapshot(`panel-${index}`),
        slot: index
      })
    )
    expect(assignNewPanelToFrontSlot(panels)).toEqual({
      slot: 0,
      displaced: {
        id: 'panel-0',
        slot: 4
      }
    })

    const placements = allocatePanelSlots([
      { ...panels[0]!, slot: 4 },
      ...panels.slice(1),
      { ...snapshot('new-panel'), slot: 0 }
    ], { x: 0, y: 0, z: -2.4 })
    const existing = placements.find(
      placement => placement.id === 'panel-0'
    )!
    const created = placements.find(
      placement => placement.id === 'new-panel'
    )!
    expect(Math.abs(existing.position.x - created.position.x))
      .toBeLessThan(0.15)
    expect(Math.abs(existing.position.y - created.position.y))
      .toBeLessThan(0.05)
    expect(created.position.z - existing.position.z).toBeCloseTo(0.55)
  })

  it('keeps a manual pane identity without consuming an automatic slot', () => {
    const manual = {
      ...snapshot('manual'),
      userMoved: true,
      slot: 0,
      position: { x: 0.35, y: 1.5, z: -1.1 }
    }
    const automatic = { ...snapshot('automatic'), slot: 0 }
    const placements = allocatePanelSlots(
      [manual, automatic],
      { x: 0, y: 0, z: -2.4 }
    )
    expect(placements.find(placement => placement.id === 'manual'))
      .toMatchObject({ slot: 0, position: manual.position })
    expect(placements.find(placement => placement.id === 'automatic'))
      .toMatchObject({ slot: 0 })
  })
})

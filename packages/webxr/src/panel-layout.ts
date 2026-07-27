import { MAX_VISIBLE_PANELS } from './config'
import type { SpatialPanelSnapshot } from './panel-model'

export type SpatialPoint = {
  x: number
  y: number
  z: number
}

export type PanelPlacement = {
  id: string
  slot: number
  position: SpatialPoint
  overflow: boolean
}

const slots: SpatialPoint[] = [
  { x: -2.25, y: 1.45, z: 0.4 },
  { x: 2.25, y: 1.45, z: 0.4 },
  { x: -2.55, y: 1.15, z: -0.6 },
  { x: 2.55, y: 1.15, z: -0.6 },
  { x: -2.05, y: 2.25, z: -0.3 },
  { x: 2.05, y: 2.25, z: -0.3 },
  { x: -2.7, y: 2.1, z: -1.35 },
  { x: 2.7, y: 2.1, z: -1.35 }
]

export const allocatePanelSlots = (
  panels: readonly SpatialPanelSnapshot[],
  center: SpatialPoint
): PanelPlacement[] => {
  const stable = [...panels].sort((first, second) => {
    if (first.background !== second.background) {
      return first.background ? -1 : 1
    }
    if (first.slot != null !== (second.slot != null)) {
      return first.slot != null ? -1 : 1
    }
    return first.id.localeCompare(second.id)
  })
  const occupied = new Set<number>()
  const placements: PanelPlacement[] = []

  for (const [index, panel] of stable.entries()) {
    if (index >= MAX_VISIBLE_PANELS) {
      placements.push({
        id: panel.id,
        slot: -1,
        position: { ...center },
        overflow: true
      })
      continue
    }

    let slot = panel.slot
    if (slot == null || slot < 0 || slot >= slots.length || occupied.has(slot)) {
      slot = slots.findIndex((_candidate, candidateIndex) => !occupied.has(candidateIndex))
    }
    const offset = slots[slot] ?? slots[0]!
    occupied.add(slot)
    placements.push({
      id: panel.id,
      slot,
      position: {
        x: center.x + offset.x,
        y: center.y + offset.y,
        z: center.z + offset.z
      },
      overflow: false
    })
  }

  return placements
}

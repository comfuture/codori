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

export type PanelSlotAssignment = {
  id: string
  slot: number
}

const slots: SpatialPoint[] = [
  { x: -1.25, y: 1.45, z: 0.15 },
  { x: 1.25, y: 1.45, z: 0.15 },
  { x: -1.45, y: 1.15, z: -0.35 },
  { x: 1.45, y: 1.15, z: -0.35 },
  { x: -1.15, y: 2.2, z: -0.2 },
  { x: 1.15, y: 2.2, z: -0.2 },
  { x: -1.55, y: 2.05, z: -0.95 },
  { x: 1.55, y: 2.05, z: -0.95 }
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

export const promotePanelToFrontSlots = (
  panels: readonly SpatialPanelSnapshot[],
  panelId: string
): PanelSlotAssignment[] => {
  const placements = allocatePanelSlots(
    panels,
    { x: 0, y: 0, z: 0 }
  ).filter(placement => !placement.overflow)
  const selected = placements.find(placement => placement.id === panelId)
  if (!selected) {
    return []
  }
  return placements
    .filter(placement =>
      placement.id === panelId
      || placement.slot < selected.slot
    )
    .map(placement => ({
      id: placement.id,
      slot: placement.id === panelId
        ? 0
        : placement.slot + 1
    }))
}

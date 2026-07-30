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

export type NewPanelSlotAssignment = {
  slot: number
  displaced: {
    id: string
    slot: number
  } | null
}

const slots: SpatialPoint[] = [
  { x: -1.1, y: 1.35, z: 0.2 },
  { x: 1.1, y: 1.35, z: 0.2 },
  { x: -1.1, y: 2.2, z: 0 },
  { x: 1.1, y: 2.2, z: 0 },
  { x: -1.2, y: 1.38, z: -0.35 },
  { x: 1.2, y: 1.38, z: -0.35 },
  { x: -1.2, y: 2.23, z: -0.55 },
  { x: 1.2, y: 2.23, z: -0.55 }
]

const frontSlots = [0, 1, 2, 3] as const

export const assignNewPanelToFrontSlot = (
  panels: readonly SpatialPanelSnapshot[]
): NewPanelSlotAssignment | null => {
  const occupantBySlot = new Map(
    panels
      .filter(panel =>
        !panel.userMoved
        && panel.slot != null
        && panel.slot >= 0
        && panel.slot < slots.length
      )
      .map(panel => [panel.slot!, panel])
  )
  const emptyAnchor = frontSlots.find(frontSlot =>
    !occupantBySlot.has(frontSlot)
    && !occupantBySlot.has(frontSlot + frontSlots.length)
  )
  if (emptyAnchor != null) {
    return {
      slot: emptyAnchor,
      displaced: null
    }
  }

  const openFront = frontSlots.find(frontSlot =>
    !occupantBySlot.has(frontSlot)
  )
  if (openFront != null) {
    return {
      slot: openFront,
      displaced: null
    }
  }

  for (const frontSlot of frontSlots) {
    const backSlot = frontSlot + frontSlots.length
    const occupant = occupantBySlot.get(frontSlot)
    if (occupant && !occupantBySlot.has(backSlot)) {
      return {
        slot: frontSlot,
        displaced: {
          id: occupant.id,
          slot: backSlot
        }
      }
    }
  }
  return null
}

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

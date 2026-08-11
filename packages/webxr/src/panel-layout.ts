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
  overflowed: {
    id: string
  } | null
  position: SpatialPoint | null
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
const PANEL_PROJECTED_WIDTH_METERS = 1.55
const PANEL_PROJECTED_HEIGHT_METERS = 0.92
const PANEL_FORWARD_LAYER_GAP_METERS = 0.28
const PANEL_MAX_AUTOMATIC_FORWARD_Z = 1.7

const projectedManualOverlaps = (
  frontSlot: number,
  panels: readonly SpatialPanelSnapshot[]
) => {
  const anchor = slots[frontSlot]!
  return panels.filter(panel =>
    panel.userMoved
    && panel.position !== null
    && Math.abs(panel.position.x - anchor.x) < PANEL_PROJECTED_WIDTH_METERS
    && Math.abs(panel.position.y - anchor.y) < PANEL_PROJECTED_HEIGHT_METERS
  )
}

const rankedFrontSlots = (
  panels: readonly SpatialPanelSnapshot[]
) => [...frontSlots].sort((first, second) => (
  projectedManualOverlaps(first, panels).length
    - projectedManualOverlaps(second, panels).length
) || first - second)

const resolveNewPanelPosition = (
  frontSlot: number,
  panels: readonly SpatialPanelSnapshot[]
) => {
  const overlapping = projectedManualOverlaps(frontSlot, panels)
  if (overlapping.length === 0) {
    return null
  }
  const anchor = slots[frontSlot]!
  return {
    ...anchor,
    z: Math.min(
      PANEL_MAX_AUTOMATIC_FORWARD_Z,
      Math.max(
        anchor.z,
        ...overlapping.map(panel => (
          panel.position!.z + PANEL_FORWARD_LAYER_GAP_METERS
        ))
      )
    )
  }
}

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
  const ranked = rankedFrontSlots(panels)
  const result = (
    slot: number,
    displaced: NewPanelSlotAssignment['displaced'] = null,
    overflowed: NewPanelSlotAssignment['overflowed'] = null
  ): NewPanelSlotAssignment => ({
    slot,
    displaced,
    overflowed,
    position: resolveNewPanelPosition(slot, panels)
  })
  const emptyAnchor = ranked.find(frontSlot =>
    !occupantBySlot.has(frontSlot)
    && !occupantBySlot.has(frontSlot + frontSlots.length)
  )
  if (emptyAnchor != null) {
    return result(emptyAnchor)
  }

  const openFront = ranked.find(frontSlot =>
    !occupantBySlot.has(frontSlot)
  )
  if (openFront != null) {
    return result(openFront)
  }

  for (const frontSlot of ranked) {
    const backSlot = frontSlot + frontSlots.length
    const occupant = occupantBySlot.get(frontSlot)
    if (occupant && !occupantBySlot.has(backSlot)) {
      return result(frontSlot, {
        id: occupant.id,
        slot: backSlot
      })
    }
  }

  const frontSlot = ranked[0]!
  const backSlot = frontSlot + frontSlots.length
  const frontOccupant = occupantBySlot.get(frontSlot)!
  const backOccupant = occupantBySlot.get(backSlot)!
  return result(frontSlot, {
    id: frontOccupant.id,
    slot: backSlot
  }, {
    id: backOccupant.id
  })
}

export const allocatePanelSlots = (
  panels: readonly SpatialPanelSnapshot[],
  center: SpatialPoint
): PanelPlacement[] => {
  const stable = [...panels].sort((first, second) => {
    if (first.slot != null !== (second.slot != null)) {
      return first.slot != null ? -1 : 1
    }
    if (first.background !== second.background) {
      return first.background ? -1 : 1
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

    if (panel.userMoved && panel.position) {
      placements.push({
        id: panel.id,
        slot: panel.slot ?? -1,
        position: { ...panel.position },
        overflow: false
      })
      continue
    }

    if (panel.position && panel.slot != null && !occupied.has(panel.slot)) {
      occupied.add(panel.slot)
      placements.push({
        id: panel.id,
        slot: panel.slot,
        position: { ...panel.position },
        overflow: false
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

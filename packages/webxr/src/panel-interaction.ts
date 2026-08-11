export type InteractionSourceId = string
export type PanelHitZone =
  | 'move'
  | 'dismiss'
  | 'scroll-up'
  | 'scroll-down'

export type PanelHit = {
  panelId: string
  zone: PanelHitZone
}

export type InteractionSourceState = {
  hover: PanelHit | null
  selected: PanelHit | null
  grabbedPanelId: string | null
  lastNativeSelectAt: number
}

export type InteractionSnapshot = {
  sources: ReadonlyMap<InteractionSourceId, InteractionSourceState>
  grabOwners: ReadonlyMap<string, InteractionSourceId>
  activePanelId: string | null
}

const createSourceState = (): InteractionSourceState => ({
  hover: null,
  selected: null,
  grabbedPanelId: null,
  lastNativeSelectAt: Number.NEGATIVE_INFINITY
})

export class PanelInteractionModel {
  private readonly sources = new Map<InteractionSourceId, InteractionSourceState>()

  private readonly grabOwners = new Map<string, InteractionSourceId>()

  private activePanelId: string | null = null

  private source(id: InteractionSourceId) {
    const existing = this.sources.get(id)
    if (existing) {
      return existing
    }
    const created = createSourceState()
    this.sources.set(id, created)
    return created
  }

  hover(sourceId: InteractionSourceId, hit: PanelHit | null) {
    const source = this.source(sourceId)
    source.hover = hit
  }

  selectStart(
    sourceId: InteractionSourceId,
    hit: PanelHit | null,
    now: number,
    native = true
  ) {
    const source = this.source(sourceId)
    if (!native && now - source.lastNativeSelectAt < 250) {
      return false
    }
    if (native) {
      source.lastNativeSelectAt = now
    }
    source.selected = hit
    this.activePanelId = hit?.panelId ?? null
    return Boolean(hit)
  }

  selectEnd(sourceId: InteractionSourceId) {
    const source = this.sources.get(sourceId)
    if (source) {
      source.selected = null
    }
  }

  grabStart(sourceId: InteractionSourceId, hit: PanelHit | null) {
    if (!hit || hit.zone !== 'move') {
      return false
    }
    const owner = this.grabOwners.get(hit.panelId)
    if (owner && owner !== sourceId) {
      return false
    }
    const source = this.source(sourceId)
    this.releaseGrab(sourceId)
    source.grabbedPanelId = hit.panelId
    this.grabOwners.set(hit.panelId, sourceId)
    this.activePanelId = hit.panelId
    return true
  }

  activatePanel(panelId: string) {
    this.activePanelId = panelId
  }

  releaseGrab(sourceId: InteractionSourceId) {
    const source = this.sources.get(sourceId)
    if (!source?.grabbedPanelId) {
      return
    }
    if (this.grabOwners.get(source.grabbedPanelId) === sourceId) {
      this.grabOwners.delete(source.grabbedPanelId)
    }
    source.grabbedPanelId = null
  }

  sourceLost(sourceId: InteractionSourceId) {
    this.releaseGrab(sourceId)
    this.sources.delete(sourceId)
  }

  dismissPanel(panelId: string) {
    for (const [sourceId, source] of this.sources.entries()) {
      if (source.hover?.panelId === panelId) {
        source.hover = null
      }
      if (source.selected?.panelId === panelId) {
        source.selected = null
      }
      if (source.grabbedPanelId === panelId) {
        this.releaseGrab(sourceId)
      }
    }
    if (this.activePanelId === panelId) {
      this.activePanelId = null
    }
  }

  reconcilePanels(panelIds: ReadonlySet<string>) {
    for (const [sourceId, source] of this.sources) {
      if (source.hover && !panelIds.has(source.hover.panelId)) {
        source.hover = null
      }
      if (source.selected && !panelIds.has(source.selected.panelId)) {
        source.selected = null
      }
      if (source.grabbedPanelId && !panelIds.has(source.grabbedPanelId)) {
        this.releaseGrab(sourceId)
      }
    }
    if (
      this.activePanelId
      && !panelIds.has(this.activePanelId)
    ) {
      this.activePanelId = null
    }
  }

  snapshot(): InteractionSnapshot {
    return {
      sources: new Map([...this.sources.entries()].map(([id, source]) => [
        id,
        { ...source }
      ])),
      grabOwners: new Map(this.grabOwners),
      activePanelId: this.activePanelId
    }
  }

  clear() {
    this.sources.clear()
    this.grabOwners.clear()
    this.activePanelId = null
  }
}

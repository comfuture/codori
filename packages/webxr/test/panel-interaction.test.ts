import { describe, expect, it, vi } from 'vitest'
import { Group, Line, Mesh, type WebGLRenderer } from 'three'
import { ImmersiveInteractionSystem } from '../src/interaction-system'
import { PanelInteractionModel } from '../src/panel-interaction'

describe('panel interaction model', () => {
  it('separates content selection from grab zones', () => {
    const model = new PanelInteractionModel()
    expect(model.grabStart('left', {
      panelId: 'panel-1',
      zone: 'content'
    })).toBe(false)
    expect(model.selectStart('left', {
      panelId: 'panel-1',
      zone: 'content'
    }, 0)).toBe(true)
    expect(model.snapshot().sources.get('left')?.selected?.zone).toBe('content')
  })

  it('resolves competing grabs deterministically and releases on source loss', () => {
    const model = new PanelInteractionModel()
    const hit = {
      panelId: 'panel-1',
      zone: 'grab' as const
    }
    expect(model.grabStart('left', hit)).toBe(true)
    expect(model.grabStart('right', hit)).toBe(false)
    expect(model.snapshot().grabOwners.get('panel-1')).toBe('left')

    model.sourceLost('left')
    expect(model.grabStart('right', hit)).toBe(true)
    expect(model.snapshot().grabOwners.get('panel-1')).toBe('right')
  })

  it('de-duplicates synthesized hand actions after a native select', () => {
    const model = new PanelInteractionModel()
    const hit = {
      panelId: 'panel-1',
      zone: 'content' as const
    }
    expect(model.selectStart('hand', hit, 1_000, true)).toBe(true)
    expect(model.selectStart('hand', hit, 1_100, false)).toBe(false)
    expect(model.selectStart('hand', hit, 1_300, false)).toBe(true)
  })

  it('removes input listeners and disposes fallback geometry on teardown', () => {
    const targetRays = [new Group(), new Group()]
    const grips = [new Group(), new Group()]
    const hands = [new Group(), new Group()]
    const renderer = {
      xr: {
        getController: (index: number) => targetRays[index],
        getControllerGrip: (index: number) => grips[index],
        getHand: (index: number) => hands[index]
      }
    } as unknown as WebGLRenderer
    const root = new Group()
    const system = new ImmersiveInteractionSystem({
      renderer,
      root,
      getPanels: () => new Map(),
      getControlTargets: () => [],
      onScroll: () => {},
      onPanelMoved: () => {},
      onAction: () => {}
    })
    const listenerRemoval = targetRays.map(targetRay =>
      vi.spyOn(targetRay, 'removeEventListener')
    )
    const rayGeometryDisposal = targetRays.map((targetRay) => {
      const ray = targetRay.getObjectByName('generic-controller-ray')
      if (!(ray instanceof Line)) {
        throw new Error('Expected a generic controller ray.')
      }
      return vi.spyOn(ray.geometry, 'dispose')
    })
    const gripGeometryDisposal = grips.map((grip) => {
      const marker = grip.getObjectByName('generic-controller-grip')
      if (!(marker instanceof Mesh)) {
        throw new Error('Expected a generic controller grip.')
      }
      return vi.spyOn(marker.geometry, 'dispose')
    })

    system.dispose()

    expect(listenerRemoval.every(spy => spy.mock.calls.length === 6)).toBe(true)
    expect(rayGeometryDisposal.every(spy => spy.mock.calls.length === 1)).toBe(true)
    expect(gripGeometryDisposal.every(spy => spy.mock.calls.length === 1)).toBe(true)
    expect(root.children).toHaveLength(0)
  })
})

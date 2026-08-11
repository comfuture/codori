import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  PANEL_CONTROL_DEPTH_METERS,
  PANEL_CONTROL_RADIUS_METERS,
  PANEL_CONTROL_SIZE_METERS,
  PANEL_WORLD_DEPTH_RENDER_ORDER,
  SpatialPanelView,
  createPanelContentRenderSignature,
  resolvePanelHeight,
  resolvePanelControlLayout,
  resolvePanelInteractionLayout,
  resolvePanelSlotTransition,
  resolvePanelViewportStart,
  resolvePanelVisualState
} from '../src/panel-view'
import {
  CanvasTextSurface,
  resolveTextViewportMetrics,
  type TextViewportMetrics
} from '../src/text-surface'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('spatial panel visual states', () => {
  it('shrinks short output while keeping the current size as the maximum', () => {
    expect(resolvePanelHeight('done')).toBe(0.44)
    expect(resolvePanelHeight(
      Array.from({ length: 8 }, (_, index) => `line ${index}`).join('\n')
    )).toBeGreaterThan(0.44)
    expect(resolvePanelHeight('output\n'.repeat(40))).toBe(0.92)
    expect(resolvePanelHeight('한'.repeat(300)))
      .toBeGreaterThan(resolvePanelHeight('a'.repeat(300)))
  })

  it('keeps the compact visible header separate from scrollable content', () => {
    const layout = resolvePanelInteractionLayout(1.55, 0.92)
    const titleBottom = layout.titleBar.y - (layout.titleBar.height / 2)
    const contentTop = layout.content.y + (layout.content.height / 2)

    expect(layout.titleBar).toMatchObject({
      width: 1.48,
      height: 0.11
    })
    expect(contentTop).toBeLessThan(titleBottom)
    expect(layout.move).toMatchObject({ width: 1.55, height: 0.92, y: 0 })
  })

  it('keeps interaction state out of the content render signature', () => {
    const content = {
      title: 'Run tests',
      status: 'in progress',
      body: 'same pixels',
      scrollLine: 2
    }
    expect(createPanelContentRenderSignature(content))
      .toBe(createPanelContentRenderSignature({ ...content }))
    expect(createPanelContentRenderSignature(content)).not.toContain('active')
  })

  it('keeps content and independent chrome in world-depth sort order', () => {
    expect(PANEL_WORLD_DEPTH_RENDER_ORDER).toBe(0)
  })

  it('does not rerender canvas pixels when active, hover, or grab changes', () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({})
      })
    })
    const render = vi.spyOn(CanvasTextSurface.prototype, 'render')
      .mockReturnValue({
        totalLineCount: 3,
        visibleLineCount: 2,
        startLine: 1,
        endLine: 3,
        hasAbove: true,
        hasBelow: false
      })
    const view = new SpatialPanelView({
      id: 'panel-1',
      kind: 'command',
      title: 'Render proof',
      status: 'in-progress',
      text: 'one\ntwo\nthree',
      retainedText: 'one\ntwo\nthree',
      truncated: false,
      background: false,
      phase: 'visible',
      phaseStartedAt: 0,
      scrollOffset: Number.POSITIVE_INFINITY,
      autoFollow: true,
      userMoved: false,
      position: null,
      slot: 0,
      fileTransitionStartedAt: 0
    })
    render.mockClear()

    view.setInteraction(true, false, true)
    view.setInteraction(true, true, true)
    view.setInteraction(false, false, false)

    expect(render).not.toHaveBeenCalled()
    expect(view.group.getObjectByName('panel-outline:panel-1')?.renderOrder)
      .toBe(PANEL_WORLD_DEPTH_RENDER_ORDER)
    expect(view.group.getObjectByName('panel-glow:panel-1')?.renderOrder)
      .toBe(PANEL_WORLD_DEPTH_RENDER_ORDER)
    view.dispose()
  })

  it('rerenders only when the effective clamped viewport line changes', () => {
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 0,
        height: 0,
        getContext: () => ({})
      })
    })
    const render = vi.spyOn(CanvasTextSurface.prototype, 'render')
      .mockImplementation(function (
        this: CanvasTextSurface,
        content
      ) {
        const metrics = resolveTextViewportMetrics(
          content.body.split('\n').length,
          2,
          content.scrollLine
        )
        ;(this as unknown as { viewportMetrics: TextViewportMetrics })
          .viewportMetrics = metrics
        return metrics
      })
    const body = Array.from({ length: 8 }, (_, index) => `line ${index}`)
      .join('\n')
    const snapshot = {
      id: 'panel-scroll',
      kind: 'command' as const,
      title: 'Scroll proof',
      status: 'in-progress' as const,
      text: body,
      retainedText: body,
      truncated: false,
      background: false,
      phase: 'visible' as const,
      phaseStartedAt: 0,
      scrollOffset: 1.1,
      autoFollow: false,
      userMoved: false,
      position: null,
      slot: 0,
      fileTransitionStartedAt: 0
    }
    const view = new SpatialPanelView(snapshot)
    render.mockClear()

    view.update({ ...snapshot, scrollOffset: 1.4 })
    expect(render).not.toHaveBeenCalled()
    view.update({ ...snapshot, scrollOffset: 1.6 })
    expect(render).toHaveBeenCalledTimes(1)
    view.update({ ...snapshot, scrollOffset: 1.7 })
    expect(render).toHaveBeenCalledTimes(1)

    view.update({ ...snapshot, scrollOffset: -100 })
    expect(render).toHaveBeenCalledTimes(2)
    view.update({ ...snapshot, scrollOffset: -200 })
    expect(render).toHaveBeenCalledTimes(2)
    view.update({ ...snapshot, scrollOffset: 100 })
    expect(render).toHaveBeenCalledTimes(3)
    view.update({ ...snapshot, scrollOffset: 200 })
    expect(render).toHaveBeenCalledTimes(3)

    const longerBody = `${body}\nnew line`
    view.update({
      ...snapshot,
      text: longerBody,
      retainedText: longerBody,
      scrollOffset: 200
    })
    expect(render).toHaveBeenCalledTimes(4)
    expect(view.maximumScrollStart).toBe(7)
    expect(resolvePanelViewportStart({
      totalLineCount: 9,
      visibleLineCount: 2,
      startLine: 7,
      endLine: 9,
      hasAbove: true,
      hasBelow: false
    }, 999)).toBe(7)
    view.dispose()
  })

  it('keeps the compact dismiss control above the top-right edge', () => {
    const layout = resolvePanelControlLayout(1.55, 0.92)
    expect(layout.dismiss.y).toBeGreaterThan(0.92 / 2)
    expect(PANEL_CONTROL_RADIUS_METERS)
      .toBeLessThan(PANEL_CONTROL_SIZE_METERS / 4)
    expect(PANEL_CONTROL_DEPTH_METERS).toBeGreaterThan(0.02)
  })

  it('uses a 250ms standard scale transition', () => {
    expect(resolvePanelVisualState('appearing', 0).normalizedScale).toBe(0)
    expect(resolvePanelVisualState('appearing', 125).normalizedScale)
      .toBeGreaterThan(0.8)
    expect(resolvePanelVisualState('appearing', 250).normalizedScale).toBe(1)
    expect(resolvePanelVisualState('disappearing', 250).normalizedScale).toBe(0)
  })

  it('uses the standard eased transition when cycling panel slots', () => {
    expect(resolvePanelSlotTransition(0)).toBe(0)
    expect(resolvePanelSlotTransition(125)).toBeGreaterThan(0.8)
    expect(resolvePanelSlotTransition(250)).toBe(1)
  })

  it('expands to double size and fades over a 125ms forced dismissal', () => {
    expect(resolvePanelVisualState('bursting', 0)).toMatchObject({
      burstScale: 1,
      opacity: 1,
      particleProgress: 0
    })
    expect(resolvePanelVisualState('bursting', 62.5)).toMatchObject({
      burstScale: 1.125,
      opacity: 0.875,
      particleProgress: 0.5
    })
    expect(resolvePanelVisualState('bursting', 125)).toMatchObject({
      burstScale: 2,
      opacity: 0,
      particleProgress: 1
    })
  })
})

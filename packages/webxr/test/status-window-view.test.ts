import { describe, expect, it, vi } from 'vitest'
import {
  drawStatusToggle,
  drawStatusWindowFrame,
  STATUS_WINDOW_ACTION_APPEARANCE,
  STATUS_WINDOW_APPEARANCE,
  STATUS_WINDOW_CORNER_RADIUS_PIXELS,
  STATUS_WINDOW_HEIGHT_METERS,
  STATUS_WINDOW_HIT_DEPTH_METERS,
  STATUS_WINDOW_TOGGLE_APPEARANCE,
  STATUS_WINDOW_WIDTH_METERS
} from '../src/status-window-view'

describe('status window view', () => {
  it('uses the requested one-third physical size', () => {
    expect(STATUS_WINDOW_WIDTH_METERS).toBeCloseTo(0.72 / 3)
    expect(STATUS_WINDOW_HEIGHT_METERS).toBeCloseTo(0.96 / 3)
    expect(STATUS_WINDOW_HIT_DEPTH_METERS).toBeLessThan(0.01)
  })

  it('draws one rounded saturated lime frame with a soft glow', () => {
    const context = {
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 0,
      shadowColor: '',
      shadowBlur: 0
    }
    drawStatusWindowFrame(context)
    expect(context.roundRect).toHaveBeenCalledWith(
      12,
      12,
      696,
      936,
      STATUS_WINDOW_CORNER_RADIUS_PIXELS
    )
    expect(context.fillStyle).toBe(STATUS_WINDOW_APPEARANCE.background)
    expect(context.strokeStyle).toBe(STATUS_WINDOW_APPEARANCE.border)
    expect(context.shadowColor).toBe(STATUS_WINDOW_APPEARANCE.glow)
    expect(context.lineWidth).toBe(6)
    expect(context.fill).toHaveBeenCalledTimes(1)
    expect(context.stroke).toHaveBeenCalledTimes(1)
    expect(context.shadowBlur).toBe(0)
    expect(STATUS_WINDOW_APPEARANCE.accent).toBe('#c8ff4d')
  })

  it('uses a distinctly brighter lime fill for direct-touch feedback', () => {
    expect(STATUS_WINDOW_ACTION_APPEARANCE.pressedFill)
      .not.toBe(STATUS_WINDOW_ACTION_APPEARANCE.idleFill)
    expect(STATUS_WINDOW_ACTION_APPEARANCE.pressedFill)
      .toContain('0.42')
    expect(STATUS_WINDOW_ACTION_APPEARANCE.pressedBorder)
      .toContain('0.96')
  })

  it('moves a real toggle knob between off and on states', () => {
    const context = {
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      fillStyle: ''
    }
    drawStatusToggle(context, {
      checked: false,
      available: true,
      centerY: 620
    })
    const offKnobX = context.roundRect.mock.calls[1]?.[0] as number
    expect(context.fillStyle).toBe(STATUS_WINDOW_TOGGLE_APPEARANCE.knob)

    context.roundRect.mockClear()
    drawStatusToggle(context, {
      checked: true,
      available: true,
      centerY: 620
    })
    const onKnobX = context.roundRect.mock.calls[1]?.[0] as number
    expect(onKnobX).toBeGreaterThan(offKnobX)
  })
})

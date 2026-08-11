import { describe, expect, it, vi } from 'vitest'
import {
  drawStatusWindowFrame,
  STATUS_WINDOW_APPEARANCE,
  STATUS_WINDOW_CORNER_RADIUS_PIXELS,
  STATUS_WINDOW_HEIGHT_METERS,
  STATUS_WINDOW_WIDTH_METERS
} from '../src/status-window-view'

describe('status window view', () => {
  it('uses the requested one-third physical size', () => {
    expect(STATUS_WINDOW_WIDTH_METERS).toBeCloseTo(0.72 / 3)
    expect(STATUS_WINDOW_HEIGHT_METERS).toBeCloseTo(0.96 / 3)
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
})

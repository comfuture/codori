import { afterEach, describe, expect, it, vi } from 'vitest'
import { NormalBlending } from 'three'
import {
  PASSTHROUGH_DARK_FEATHER_STOPS,
  PassthroughContrastView
} from '../src/passthrough-contrast'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('passthrough orb contrast', () => {
  it('defines one monotonic neutral-dark feather ending fully transparent', () => {
    expect(PASSTHROUGH_DARK_FEATHER_STOPS[0]?.[0]).toBe(0)
    expect(PASSTHROUGH_DARK_FEATHER_STOPS.at(-1)).toEqual([
      1,
      'rgba(5, 7, 9, 0)'
    ])
    expect(PASSTHROUGH_DARK_FEATHER_STOPS.every(
      ([offset], index, stops) => index === 0 || offset > stops[index - 1]![0]
    )).toBe(true)
    expect(PASSTHROUGH_DARK_FEATHER_STOPS.map(([, color]) => color).join(' '))
      .not.toMatch(/noise|dot|stipple|checker/i)
  })

  it('uses a smooth sprite only for alpha blend and leaves opaque mode unchanged', () => {
    const addColorStop = vi.fn()
    const context = {
      createRadialGradient: vi.fn(() => ({ addColorStop })),
      fillRect: vi.fn(),
      fillStyle: ''
    }
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => context)
      }))
    })
    const view = new PassthroughContrastView()

    expect(addColorStop.mock.calls).toEqual(
      PASSTHROUGH_DARK_FEATHER_STOPS.map(stop => [...stop])
    )
    expect(view.group.visible).toBe(false)
    expect(view.feather.name).toBe('alpha-passthrough-dark-feather')
    expect(view.feather.userData).toMatchObject({
      contrast: 'dark-feather',
      pattern: 'smooth-radial-gradient'
    })
    expect(view.feather.material).toMatchObject({
      transparent: true,
      blending: NormalBlending,
      depthWrite: false,
      opacity: 0.84
    })

    view.setBlendMode('alpha-blend')
    expect(view.group.visible).toBe(true)
    expect(view.feather.visible).toBe(true)
    expect(view.additiveOutline.visible).toBe(false)
    view.setBlendMode('additive')
    expect(view.feather.visible).toBe(false)
    expect(view.additiveOutline.visible).toBe(true)
    view.setBlendMode('opaque')
    expect(view.group.visible).toBe(false)
    view.dispose()
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  createImmersiveSessionInit,
  detectImmersiveCapability,
  requestImmersiveSession,
  resolvePassthroughAvailability
} from '../src/xr-capability'

describe('immersive WebXR capability', () => {
  it('builds the required local-floor session with optional progressive enhancements', () => {
    expect(createImmersiveSessionInit()).toEqual({
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor', 'hand-tracking', 'layers']
    })
  })

  it('checks secure context and immersive-vr support without requesting a session', async () => {
    const requestSession = vi.fn()
    const isSessionSupported = vi.fn(async () => true)

    await expect(detectImmersiveCapability({
      secureContext: true,
      xr: { isSessionSupported, requestSession }
    })).resolves.toEqual({
      status: 'available',
      modes: { vr: true, ar: true },
      entryMode: 'immersive-vr'
    })
    expect(isSessionSupported).toHaveBeenCalledWith('immersive-vr')
    expect(isSessionSupported).toHaveBeenCalledWith('immersive-ar')
    expect(requestSession).not.toHaveBeenCalled()
  })

  it.each([
    { vr: true, ar: false, entryMode: 'immersive-vr' },
    { vr: false, ar: true, entryMode: 'immersive-ar' },
    { vr: true, ar: true, entryMode: 'immersive-vr' }
  ] as const)('supports the $entryMode capability matrix', async ({ vr, ar, entryMode }) => {
    const isSessionSupported = vi.fn(async (mode: XRSessionMode) =>
      mode === 'immersive-vr' ? vr : ar
    )
    await expect(detectImmersiveCapability({
      secureContext: true,
      xr: { isSessionSupported, requestSession: vi.fn() }
    })).resolves.toMatchObject({
      status: 'available',
      modes: { vr, ar },
      entryMode
    })
  })

  it('reports neither mode as unsupported', async () => {
    await expect(detectImmersiveCapability({
      secureContext: true,
      xr: {
        isSessionSupported: vi.fn(async () => false),
        requestSession: vi.fn()
      }
    })).resolves.toMatchObject({ status: 'unsupported' })
  })

  it('keeps working VR available when the AR probe rejects', async () => {
    await expect(detectImmersiveCapability({
      secureContext: true,
      xr: {
        isSessionSupported: vi.fn(async (mode: XRSessionMode) => {
          if (mode === 'immersive-ar') throw new Error('AR probe unavailable')
          return true
        }),
        requestSession: vi.fn()
      }
    })).resolves.toMatchObject({
      status: 'available',
      modes: { vr: true, ar: false },
      entryMode: 'immersive-vr'
    })
  })

  it('reports insecure and unsupported browsers with an actionable fallback', async () => {
    await expect(detectImmersiveCapability({
      secureContext: false
    })).resolves.toMatchObject({
      status: 'insecure'
    })
    await expect(detectImmersiveCapability({
      secureContext: true
    })).resolves.toMatchObject({
      status: 'unsupported'
    })
  })

  it('requests immersive-vr only from the explicit request helper', async () => {
    const session = {} as XRSession
    const requestSession = vi.fn(async () => session)
    const environment = {
      secureContext: true,
      xr: {
        isSessionSupported: vi.fn(async () => true),
        requestSession
      }
    }

    await expect(requestImmersiveSession(environment)).resolves.toBe(session)
    expect(requestSession).toHaveBeenCalledWith(
      'immersive-vr',
      createImmersiveSessionInit()
    )
  })

  it('requests immersive AR explicitly and includes DOM overlay only when provided', async () => {
    const session = {} as XRSession
    const requestSession = vi.fn(async () => session)
    const root = {} as Element
    await requestImmersiveSession({
      secureContext: true,
      xr: { isSessionSupported: vi.fn(async () => true), requestSession }
    }, 'immersive-ar', root)
    expect(requestSession).toHaveBeenCalledWith('immersive-ar', {
      requiredFeatures: ['local-floor'],
      optionalFeatures: ['bounded-floor', 'hand-tracking', 'layers', 'dom-overlay'],
      domOverlay: { root }
    })
  })

  it('reports the honest passthrough capability and blend-mode matrix', () => {
    expect(resolvePassthroughAvailability({
      arSupported: false,
      vrSupported: true,
      mode: 'immersive-vr',
      environmentBlendMode: 'opaque'
    })).toMatchObject({ supported: false, active: false })
    expect(resolvePassthroughAvailability({
      arSupported: true,
      vrSupported: true,
      mode: 'immersive-vr',
      environmentBlendMode: 'opaque'
    })).toMatchObject({ supported: true, active: false })
    expect(resolvePassthroughAvailability({
      arSupported: true,
      vrSupported: true,
      mode: 'immersive-ar',
      environmentBlendMode: 'alpha-blend'
    })).toMatchObject({ supported: true, active: true, contrast: 'dither' })
    expect(resolvePassthroughAvailability({
      arSupported: true,
      vrSupported: true,
      mode: 'immersive-ar',
      environmentBlendMode: 'additive'
    })).toMatchObject({ supported: true, active: true, contrast: 'additive-shape' })
    expect(resolvePassthroughAvailability({
      arSupported: true,
      vrSupported: true,
      mode: 'immersive-ar',
      environmentBlendMode: 'opaque'
    })).toMatchObject({
      supported: true,
      active: false,
      contrast: 'opaque',
      disabledReason: null
    })
  })

  it('refuses session creation outside a secure context', async () => {
    const requestSession = vi.fn()
    await expect(requestImmersiveSession({
      secureContext: false,
      xr: {
        isSessionSupported: vi.fn(async () => true),
        requestSession
      }
    })).rejects.toThrow('secure context')
    expect(requestSession).not.toHaveBeenCalled()
  })
})

import { describe, expect, it, vi } from 'vitest'
import {
  createImmersiveSessionInit,
  detectImmersiveCapability,
  requestImmersiveSession
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
    })).resolves.toEqual({ status: 'available' })
    expect(isSessionSupported).toHaveBeenCalledWith('immersive-vr')
    expect(requestSession).not.toHaveBeenCalled()
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

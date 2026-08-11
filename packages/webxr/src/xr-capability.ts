export type ImmersiveCapability =
  | {
      status: 'available'
      modes: ImmersiveModeSupport
      entryMode: ImmersiveSessionMode
    }
  | { status: 'insecure', message: string }
  | { status: 'unsupported', message: string }
  | { status: 'failed', message: string }

export type XrCapabilityEnvironment = {
  secureContext: boolean
  xr?: Pick<XRSystem, 'isSessionSupported' | 'requestSession'>
}

export type ImmersiveSessionMode = 'immersive-vr' | 'immersive-ar'

export type ImmersiveModeSupport = {
  vr: boolean
  ar: boolean
}

export type PassthroughAvailability = {
  supported: boolean
  active: boolean
  contrast: 'dither' | 'additive-shape' | 'opaque'
  disabledReason: string | null
}

export const createImmersiveSessionInit = (
  domOverlayRoot?: Element | null
): XRSessionInit => ({
  requiredFeatures: ['local-floor'],
  optionalFeatures: [
    'bounded-floor',
    'hand-tracking',
    'layers',
    ...(domOverlayRoot ? ['dom-overlay' as const] : [])
  ],
  ...(domOverlayRoot
    ? { domOverlay: { root: domOverlayRoot } }
    : {})
})

export const resolvePassthroughAvailability = (input: {
  arSupported: boolean
  vrSupported: boolean
  mode: ImmersiveSessionMode
  environmentBlendMode: XREnvironmentBlendMode
}): PassthroughAvailability => {
  if (!input.arSupported) {
    return {
      supported: false,
      active: false,
      contrast: 'opaque',
      disabledReason: 'This device does not report immersive AR support.'
    }
  }
  if (input.mode === 'immersive-vr') {
    return {
      supported: true,
      active: false,
      contrast: 'opaque',
      disabledReason: null
    }
  }
  if (!input.vrSupported) {
    return {
      supported: false,
      active: input.environmentBlendMode !== 'opaque',
      contrast: input.environmentBlendMode === 'additive'
        ? 'additive-shape'
        : input.environmentBlendMode === 'alpha-blend'
          ? 'dither'
          : 'opaque',
      disabledReason: 'Immersive VR is unavailable; exit immersive to leave AR.'
    }
  }
  if (input.environmentBlendMode === 'opaque') {
    return {
      supported: true,
      active: false,
      contrast: 'opaque',
      disabledReason: null
    }
  }
  return {
    supported: true,
    active: true,
    contrast: input.environmentBlendMode === 'additive'
      ? 'additive-shape'
      : 'dither',
    disabledReason: null
  }
}

export const detectImmersiveCapability = async (
  environment: XrCapabilityEnvironment
): Promise<ImmersiveCapability> => {
  if (!environment.secureContext) {
    return {
      status: 'insecure',
      message: 'Immersive Codori requires HTTPS (or localhost) for both WebXR and realtime voice.'
    }
  }

  if (!environment.xr) {
    return {
      status: 'unsupported',
      message: 'This browser does not expose the WebXR Device API. Continue in the normal Codori workspace.'
    }
  }

  try {
    const [vrProbe, arProbe] = await Promise.allSettled([
      environment.xr.isSessionSupported('immersive-vr'),
      environment.xr.isSessionSupported('immersive-ar')
    ])
    const vr = vrProbe.status === 'fulfilled' && vrProbe.value
    const ar = arProbe.status === 'fulfilled' && arProbe.value
    if (vr || ar) {
      return {
        status: 'available',
        modes: { vr, ar },
        entryMode: vr ? 'immersive-vr' : 'immersive-ar'
      }
    }
    if (vrProbe.status === 'rejected' || arProbe.status === 'rejected') {
      const error = vrProbe.status === 'rejected'
        ? vrProbe.reason
        : arProbe.status === 'rejected'
          ? arProbe.reason
          : 'Unknown WebXR capability error.'
      return {
        status: 'failed',
        message: `Could not check immersive WebXR support: ${error instanceof Error ? error.message : String(error)}`
      }
    }
    return {
      status: 'unsupported',
      message: 'This browser does not report immersive VR or AR support. Continue in the normal Codori workspace.'
    }
  } catch (error) {
    return {
      status: 'failed',
      message: `Could not check immersive VR support: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export const requestImmersiveSession = async (
  environment: XrCapabilityEnvironment,
  mode: ImmersiveSessionMode = 'immersive-vr',
  domOverlayRoot?: Element | null
) => {
  if (!environment.secureContext) {
    throw new Error('Immersive Codori requires a secure context.')
  }
  if (!environment.xr) {
    throw new Error('WebXR is not available.')
  }

  return await environment.xr.requestSession(
    mode,
    createImmersiveSessionInit(domOverlayRoot)
  )
}

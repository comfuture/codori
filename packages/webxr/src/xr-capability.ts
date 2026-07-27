export type ImmersiveCapability =
  | { status: 'available' }
  | { status: 'insecure', message: string }
  | { status: 'unsupported', message: string }
  | { status: 'failed', message: string }

export type XrCapabilityEnvironment = {
  secureContext: boolean
  xr?: Pick<XRSystem, 'isSessionSupported' | 'requestSession'>
}

export const createImmersiveSessionInit = (): XRSessionInit => ({
  requiredFeatures: ['local-floor'],
  optionalFeatures: ['bounded-floor', 'hand-tracking', 'layers']
})

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
    const supported = await environment.xr.isSessionSupported('immersive-vr')
    return supported
      ? { status: 'available' }
      : {
          status: 'unsupported',
          message: 'This browser does not report support for immersive VR. Continue in the normal Codori workspace.'
        }
  } catch (error) {
    return {
      status: 'failed',
      message: `Could not check immersive VR support: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export const requestImmersiveSession = async (
  environment: XrCapabilityEnvironment
) => {
  if (!environment.secureContext) {
    throw new Error('Immersive Codori requires a secure context.')
  }
  if (!environment.xr) {
    throw new Error('WebXR is not available.')
  }

  return await environment.xr.requestSession(
    'immersive-vr',
    createImmersiveSessionInit()
  )
}

import {
  XR_FOVEATION,
  XR_FRAMEBUFFER_SCALE_FACTOR
} from './config'

export type ImmersiveRenderQualityTarget = {
  setFoveation: (value: number) => void
  setFramebufferScaleFactor: (value: number) => void
}

export const configureImmersiveRenderQuality = (
  target: ImmersiveRenderQualityTarget
) => {
  target.setFramebufferScaleFactor(XR_FRAMEBUFFER_SCALE_FACTOR)
  target.setFoveation(XR_FOVEATION)
}

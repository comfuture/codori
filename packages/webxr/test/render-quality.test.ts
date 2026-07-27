import {
  LinearFilter,
  LinearMipmapLinearFilter,
  SRGBColorSpace,
  Texture
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { configureImmersiveRenderQuality } from '../src/render-quality'
import { configureCanvasTextTexture } from '../src/text-surface'

describe('immersive render quality', () => {
  it('configures full-resolution foveation and supersampling before XR attachment', () => {
    const setFramebufferScaleFactor = vi.fn()
    const setFoveation = vi.fn()

    configureImmersiveRenderQuality({
      setFramebufferScaleFactor,
      setFoveation
    })

    expect(setFramebufferScaleFactor).toHaveBeenCalledWith(1.25)
    expect(setFoveation).toHaveBeenCalledWith(0)
  })

  it('uses mipmaps and anisotropy for stable moving text', () => {
    const texture = new Texture()
    texture.generateMipmaps = false

    configureCanvasTextTexture(texture)

    expect(texture).toMatchObject({
      anisotropy: 8,
      colorSpace: SRGBColorSpace,
      generateMipmaps: true,
      magFilter: LinearFilter,
      minFilter: LinearMipmapLinearFilter
    })
  })
})

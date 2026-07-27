import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteMaterial
} from 'three'
import type { LightSample } from './light-model'

const coolColor = new Color('#20ccff')
const warmColor = new Color('#ff9c78')
const mixedColor = new Color()
const mixedWarmColor = new Color()

const createGlowTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create the light glow texture.')
  }
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.12, 'rgba(142,232,255,0.95)')
  gradient.addColorStop(0.34, 'rgba(80,194,255,0.45)')
  gradient.addColorStop(0.68, 'rgba(255,128,102,0.12)')
  gradient.addColorStop(1, 'rgba(0,0,0,0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  return new CanvasTexture(canvas)
}

const createRayTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create the light ray texture.')
  }
  context.translate(128, 128)
  for (let index = 0; index < 24; index += 1) {
    const angle = (index / 24) * Math.PI * 2
    const length = index % 3 === 0 ? 112 : 82
    const gradient = context.createLinearGradient(18, 0, length, 0)
    gradient.addColorStop(0, 'rgba(121,226,255,0.24)')
    gradient.addColorStop(0.62, 'rgba(94,202,255,0.08)')
    gradient.addColorStop(1, 'rgba(0,0,0,0)')
    context.save()
    context.rotate(angle)
    context.fillStyle = gradient
    context.fillRect(18, -0.8, length - 18, 1.6)
    context.restore()
  }
  return new CanvasTexture(canvas)
}

export class AgentLightView {
  readonly group = new Group()

  private readonly glowTexture = createGlowTexture()

  private readonly rayTexture = createRayTexture()

  private readonly coreMaterial = new MeshBasicMaterial({
    color: '#91edff',
    transparent: true,
    opacity: 0.98,
    blending: AdditiveBlending,
    depthWrite: false
  })

  private readonly innerMaterial = new MeshBasicMaterial({
    color: '#ffc0a8',
    transparent: true,
    opacity: 0.62,
    blending: AdditiveBlending,
    depthWrite: false
  })

  private readonly core = new Mesh(
    new SphereGeometry(0.11, 32, 24),
    this.coreMaterial
  )

  private readonly inner = new Mesh(
    new SphereGeometry(0.065, 24, 18),
    this.innerMaterial
  )

  readonly hitTarget = new Mesh(
    new SphereGeometry(0.28, 20, 16),
    new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false
    })
  )

  private readonly haloMaterial = new SpriteMaterial({
    map: this.glowTexture,
    color: '#77dcff',
    transparent: true,
    opacity: 0.72,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true
  })

  private readonly halo = new Sprite(this.haloMaterial)

  private readonly rayMaterial = new SpriteMaterial({
    map: this.rayTexture,
    color: '#72ddff',
    transparent: true,
    opacity: 0.2,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: true
  })

  private readonly rays = new Sprite(this.rayMaterial)

  private readonly localLight = new PointLight('#7adfff', 1.2, 2.5, 2)

  private readonly flareSprites: Sprite[] = []

  private readonly flareMaterials: SpriteMaterial[] = []

  constructor() {
    this.group.name = 'agent-light'
    this.hitTarget.name = 'agent-light-voice-toggle'
    this.hitTarget.userData.action = 'toggle-voice'
    this.halo.scale.setScalar(1.35)
    this.rays.scale.setScalar(1.9)
    this.group.add(
      this.rays,
      this.halo,
      this.core,
      this.inner,
      this.hitTarget,
      this.localLight
    )

    for (let index = 0; index < 7; index += 1) {
      const material = new SpriteMaterial({
        map: this.glowTexture,
        color: index % 2 === 0 ? '#40d7ff' : '#ff9875',
        transparent: true,
        opacity: 0.18,
        blending: AdditiveBlending,
        depthWrite: false
      })
      const sprite = new Sprite(material)
      const size = 0.12 + ((index % 3) * 0.055)
      sprite.scale.setScalar(size)
      this.flareMaterials.push(material)
      this.flareSprites.push(sprite)
      this.group.add(sprite)
    }
  }

  update(sample: LightSample, timeSeconds: number) {
    mixedColor.copy(coolColor)
      .multiplyScalar(sample.coolMix)
      .add(mixedWarmColor.copy(warmColor).multiplyScalar(sample.warmMix))
      .multiplyScalar(sample.saturation)
    this.coreMaterial.color.copy(mixedColor)
    this.innerMaterial.color.copy(warmColor).lerp(coolColor, sample.coolMix * 0.35)
    this.coreMaterial.opacity = 0.78 + (sample.intensity * 0.2)
    this.innerMaterial.opacity = 0.42 + (sample.intensity * 0.2)
    this.haloMaterial.color.copy(mixedColor)
    this.haloMaterial.opacity = 0.38 + (sample.intensity * 0.28)
    this.rayMaterial.color.copy(mixedColor)
    this.rayMaterial.opacity = 0.08 + (sample.intensity * 0.12)
    this.rayMaterial.rotation = (
      sample.flarePhase * Math.PI * 2
    ) + (timeSeconds * 0.025)
    this.localLight.color.copy(mixedColor)
    this.localLight.intensity = sample.intensity * 1.4
    this.group.scale.setScalar(sample.scale)

    for (const [index, sprite] of this.flareSprites.entries()) {
      const phase = (
        sample.flarePhase
        + (index / this.flareSprites.length)
      ) * Math.PI * 2
      const radius = 0.22 + ((index % 3) * 0.09)
      sprite.position.set(
        Math.cos(phase + (timeSeconds * 0.08)) * radius,
        Math.sin((phase * 1.3) - (timeSeconds * 0.05)) * radius * 0.62,
        Math.sin(phase) * 0.08
      )
      this.flareMaterials[index]!.opacity =
        0.09 + (sample.intensity * (0.08 + ((index % 3) * 0.025)))
    }
  }

  dispose() {
    this.core.geometry.dispose()
    this.inner.geometry.dispose()
    this.hitTarget.geometry.dispose()
    this.coreMaterial.dispose()
    this.innerMaterial.dispose()
    this.hitTarget.material.dispose()
    this.haloMaterial.dispose()
    this.rayMaterial.dispose()
    for (const material of this.flareMaterials) {
      material.dispose()
    }
    this.glowTexture.dispose()
    this.rayTexture.dispose()
    this.group.clear()
  }
}

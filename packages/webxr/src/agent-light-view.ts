import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PointLight,
  ShaderMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial
} from 'three'
import type { LightSample } from './light-model'

const coolColor = new Color('#20ccff')
const warmColor = new Color('#ff9c78')
const mixedColor = new Color()
const mixedWarmColor = new Color()
const coreHighlightColor = new Color('#d9fbff')

const lobeSpecs = [
  {
    color: '#24d8ff',
    scale: [1.36, 0.62, 0.82] as const,
    phase: 0.2,
    speed: 0.67,
    opacity: 0.32
  },
  {
    color: '#ffad62',
    scale: [0.72, 1.38, 0.7] as const,
    phase: 1.4,
    speed: 0.53,
    opacity: 0.3
  },
  {
    color: '#59a7ff',
    scale: [0.76, 0.68, 1.42] as const,
    phase: 2.6,
    speed: 0.73,
    opacity: 0.28
  },
  {
    color: '#ff7fa9',
    scale: [1.18, 0.54, 1.02] as const,
    phase: 3.8,
    speed: 0.47,
    opacity: 0.24
  },
  {
    color: '#8b7dff',
    scale: [0.58, 1.12, 1.28] as const,
    phase: 5.1,
    speed: 0.61,
    opacity: 0.24
  }
] as const

const lobeVertexShader = `
  varying vec3 vObjectPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    vObjectPosition = position;
    vViewNormal = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`

const lobeFragmentShader = `
  uniform vec3 glowColor;
  uniform float glowOpacity;
  uniform float edgeFeather;
  uniform float glowBrightness;
  uniform float time;

  varying vec3 vObjectPosition;
  varying vec3 vViewNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDirection = normalize(-vViewPosition);
    float facing = abs(dot(normalize(vViewNormal), viewDirection));
    float softEdge = smoothstep(0.0, edgeFeather, facing);
    float fragmentWave = 0.76 + (
      sin(
        (vObjectPosition.x * 17.0)
        + (vObjectPosition.y * 13.0)
        - (vObjectPosition.z * 11.0)
        + time
      ) * 0.16
    );
    float innerGlow = 0.72 + (pow(facing, 0.7) * 0.38);
    float alpha = glowOpacity * softEdge * fragmentWave;
    gl_FragColor = vec4(
      glowColor
        * innerGlow
        * glowBrightness
        * (0.9 + (fragmentWave * 0.22)),
      alpha
    );
  }
`

const createLobeMaterial = (
  color: string,
  opacity: number,
  edgeFeather: number,
  glowBrightness: number,
  additive = true
) => new ShaderMaterial({
  uniforms: {
    glowColor: {
      value: new Color(color)
    },
    glowOpacity: {
      value: opacity
    },
    edgeFeather: {
      value: edgeFeather
    },
    glowBrightness: {
      value: glowBrightness
    },
    time: {
      value: 0
    }
  },
  vertexShader: lobeVertexShader,
  fragmentShader: lobeFragmentShader,
  transparent: true,
  blending: additive ? AdditiveBlending : NormalBlending,
  depthWrite: false,
  depthTest: true,
  toneMapped: false
})

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

  private readonly orb = new Group()

  private readonly glowTexture = createGlowTexture()

  private readonly rayTexture = createRayTexture()

  private readonly orbGeometry = new SphereGeometry(0.205, 40, 30)

  private readonly coreMaterial = createLobeMaterial(
    '#69dff5',
    0.74,
    0.86,
    1.06,
    false
  )

  private readonly coreGlowMaterial = createLobeMaterial(
    '#69dff5',
    0.16,
    1,
    0.82
  )

  private readonly core = new Mesh(
    this.orbGeometry,
    this.coreMaterial
  )

  private readonly coreGlow = new Mesh(
    this.orbGeometry,
    this.coreGlowMaterial
  )

  private readonly lobeMaterials: ShaderMaterial[] = []

  private readonly lobeGlowMaterials: ShaderMaterial[] = []

  private readonly lobes: Mesh[] = []

  readonly hitTarget = new Mesh(
    new SphereGeometry(0.44, 20, 16),
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
    this.orb.name = 'agent-light-morphing-orb'
    this.hitTarget.name = 'agent-light-voice-toggle'
    this.hitTarget.userData.action = 'toggle-voice'
    this.core.scale.set(1.08, 0.92, 1)
    this.coreGlow.scale.setScalar(1.22)
    this.core.add(this.coreGlow)
    this.orb.add(this.core)
    for (const spec of lobeSpecs) {
      const material = createLobeMaterial(
        spec.color,
        spec.opacity,
        0.82,
        1.04
      )
      const glowMaterial = createLobeMaterial(
        spec.color,
        spec.opacity * 0.34,
        1,
        0.76
      )
      const lobe = new Mesh(this.orbGeometry, material)
      const glow = new Mesh(this.orbGeometry, glowMaterial)
      glow.scale.setScalar(1.2)
      lobe.add(glow)
      lobe.scale.set(
        spec.scale[0],
        spec.scale[1],
        spec.scale[2]
      )
      this.lobeMaterials.push(material)
      this.lobeGlowMaterials.push(glowMaterial)
      this.lobes.push(lobe)
      this.orb.add(lobe)
    }
    this.halo.scale.setScalar(1.55)
    this.rays.scale.setScalar(2.15)
    this.group.add(
      this.rays,
      this.halo,
      this.orb,
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
    const coreColor = this.coreMaterial.uniforms.glowColor!.value as Color
    coreColor.copy(mixedColor)
      .lerp(coreHighlightColor, 0.16)
    this.coreMaterial.uniforms.glowOpacity!.value = Math.min(
      0.8,
      0.72 + (sample.intensity * 0.06)
    )
    this.coreMaterial.uniforms.time!.value = timeSeconds * 0.78
    const coreGlowColor = (
      this.coreGlowMaterial.uniforms.glowColor!.value as Color
    )
    coreGlowColor.copy(coreColor)
    this.coreGlowMaterial.uniforms.glowOpacity!.value =
      0.1 + (sample.intensity * 0.08)
    this.coreGlowMaterial.uniforms.time!.value = timeSeconds * 0.64
    const morph = sample.motion
    this.orb.rotation.set(
      Math.sin(timeSeconds * 0.27) * 0.18 * morph,
      timeSeconds * 0.16 * morph,
      Math.cos(timeSeconds * 0.21) * 0.14 * morph
    )
    this.core.scale.set(
      1.08 + (Math.sin(timeSeconds * 0.71) * 0.08 * morph),
      0.92 + (Math.cos(timeSeconds * 0.59) * 0.07 * morph),
      1 + (Math.sin(timeSeconds * 0.47 + 1.2) * 0.09 * morph)
    )
    for (const [index, lobe] of this.lobes.entries()) {
      const spec = lobeSpecs[index]!
      const phase = spec.phase + (timeSeconds * spec.speed)
      const secondary = spec.phase + (timeSeconds * (spec.speed * 0.73))
      lobe.scale.set(
        spec.scale[0] * (1 + (Math.sin(phase) * 0.23 * morph)),
        spec.scale[1] * (1 + (Math.cos(secondary) * 0.2 * morph)),
        spec.scale[2] * (
          1 + (Math.sin((phase * 0.81) + 1.1) * 0.22 * morph)
        )
      )
      lobe.rotation.set(
        phase * 0.74,
        secondary * (index % 2 === 0 ? 0.9 : -0.86),
        phase * (index % 2 === 0 ? -0.52 : 0.48)
      )
      lobe.position.set(
        Math.sin(secondary * 0.9) * 0.035 * morph,
        Math.cos(phase * 0.8) * 0.032 * morph,
        Math.sin(phase * 0.63) * 0.03 * morph
      )
      const material = this.lobeMaterials[index]!
      material.uniforms.glowOpacity!.value = Math.min(
        0.44,
        spec.opacity + (sample.intensity * 0.07)
      )
      material.uniforms.time!.value = (
        timeSeconds * (0.78 + (spec.speed * 0.6))
      ) + spec.phase
      const glowMaterial = this.lobeGlowMaterials[index]!
      glowMaterial.uniforms.glowOpacity!.value = (
        spec.opacity * 0.25
      ) + (sample.intensity * 0.045)
      glowMaterial.uniforms.time!.value = (
        timeSeconds * (0.64 + (spec.speed * 0.48))
      ) + spec.phase
    }
    this.haloMaterial.color.copy(mixedColor)
    this.haloMaterial.opacity = Math.min(
      1,
      (0.38 + (sample.intensity * 0.28)) * sample.flareIntensity
    )
    this.rayMaterial.color.copy(mixedColor)
    this.rayMaterial.opacity = Math.min(
      1,
      (0.08 + (sample.intensity * 0.12)) * sample.flareIntensity
    )
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
      this.flareMaterials[index]!.opacity = Math.min(
        1,
        (
          0.09
          + (sample.intensity * (0.08 + ((index % 3) * 0.025)))
        ) * sample.flareIntensity
      )
    }
  }

  dispose() {
    this.orbGeometry.dispose()
    this.hitTarget.geometry.dispose()
    this.coreMaterial.dispose()
    this.coreGlowMaterial.dispose()
    for (const material of this.lobeMaterials) {
      material.dispose()
    }
    for (const material of this.lobeGlowMaterials) {
      material.dispose()
    }
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

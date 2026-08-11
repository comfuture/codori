import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  Sprite,
  SpriteMaterial,
  TorusGeometry
} from 'three'

export const PASSTHROUGH_DARK_FEATHER_STOPS = [
  [0, 'rgba(5, 7, 9, 0.16)'],
  [0.34, 'rgba(5, 7, 9, 0.14)'],
  [0.54, 'rgba(5, 7, 9, 0.09)'],
  [0.74, 'rgba(5, 7, 9, 0.04)'],
  [1, 'rgba(5, 7, 9, 0)']
] as const

const createDarkFeatherTexture = () => {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create the passthrough feather texture.')
  }
  const gradient = context.createRadialGradient(128, 128, 0, 128, 128, 128)
  for (const [offset, color] of PASSTHROUGH_DARK_FEATHER_STOPS) {
    gradient.addColorStop(offset, color)
  }
  context.fillStyle = gradient
  context.fillRect(0, 0, 256, 256)
  return new CanvasTexture(canvas)
}

export class PassthroughContrastView {
  readonly group = new Group()

  readonly feather: Sprite

  readonly additiveOutline: Mesh<TorusGeometry, MeshBasicMaterial>

  private readonly featherTexture = createDarkFeatherTexture()

  private readonly featherMaterial = new SpriteMaterial({
    map: this.featherTexture,
    color: '#ffffff',
    transparent: true,
    opacity: 0.84,
    blending: NormalBlending,
    depthWrite: false,
    depthTest: true,
    toneMapped: false
  })

  constructor() {
    this.group.name = 'passthrough-orb-contrast'
    this.feather = new Sprite(this.featherMaterial)
    this.feather.name = 'alpha-passthrough-dark-feather'
    this.feather.scale.setScalar(1.48)
    this.feather.userData.contrast = 'dark-feather'
    this.feather.userData.pattern = 'smooth-radial-gradient'
    this.additiveOutline = new Mesh(
      new TorusGeometry(0.28, 0.025, 10, 48),
      new MeshBasicMaterial({
        color: '#ff6bd6',
        transparent: true,
        opacity: 0.88,
        depthWrite: false
      })
    )
    this.additiveOutline.name = 'additive-passthrough-shape-outline'
    this.additiveOutline.userData.contrast = 'additive-shape'
    this.group.add(this.feather, this.additiveOutline)
    this.setBlendMode('opaque')
  }

  setBlendMode(environmentBlendMode: XREnvironmentBlendMode) {
    this.group.visible = environmentBlendMode !== 'opaque'
    this.feather.visible = environmentBlendMode === 'alpha-blend'
    this.additiveOutline.visible = environmentBlendMode === 'additive'
  }

  dispose() {
    this.featherTexture.dispose()
    this.featherMaterial.dispose()
    this.additiveOutline.geometry.dispose()
    this.additiveOutline.material.dispose()
    this.group.removeFromParent()
    this.group.clear()
  }
}

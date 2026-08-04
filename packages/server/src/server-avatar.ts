import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { hostname } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { imageSize } from 'image-size'
import { isPathInsideDirectory } from './attachment-store.js'

const MAX_MANIFEST_BYTES = 64 * 1024
const MAX_SPRITE_BYTES = 4 * 1024 * 1024
const MAX_FRAMES = 256
const MAX_ANIMATION_COUNT = 64
const MAX_ANIMATION_FRAMES = 512
const MAX_ANIMATION_FPS = 60
const DEFAULT_FRAME_WIDTH = 192
const DEFAULT_FRAME_HEIGHT = 208
const DEFAULT_COLUMNS = 8
const DEFAULT_V1_ROWS = 9
const DEFAULT_V2_ROWS = 11
const PET_CDN_ORIGIN = 'https://persistent.oaistatic.com'
const PET_CDN_PATH = '/codex/pets/v1/'
const PET_FETCH_TIMEOUT_MS = 10_000

export type ServerAvatarSource = 'builtin' | 'custom' | 'legacy' | 'fallback'

export type ServerAvatarFrame = {
  spriteIndex: number
  durationMs: number
}

export type ServerAvatarAnimation = {
  frames: ServerAvatarFrame[]
  loopStart: number | null
  fallback: string
}

export type ServerAvatarMetadata = {
  serverId: string
  serverLabel: string
  avatarId: string
  source: ServerAvatarSource
  displayName: string
  description: string
  revision: string
  mimeType: string
  frame: {
    width: number
    height: number
    columns: number
    rows: number
    frameCount: number
  }
  animations: Record<string, ServerAvatarAnimation>
}

export type ResolvedServerAvatar = {
  metadata: ServerAvatarMetadata
  bytes: Buffer
  watchPath: string | null
}

type BuiltinPet = {
  displayName: string
  description: string
  spritesheetFile: string
}

type AvatarManifest = {
  id?: unknown
  displayName?: unknown
  description?: unknown
  spriteVersionNumber?: unknown
  spritesheetPath?: unknown
  frame?: unknown
  animations?: unknown
}

type FrameSpec = {
  width: number
  height: number
  columns: number
  rows: number
}

type FetchLike = typeof globalThis.fetch

const BUILTIN_PETS: Record<string, BuiltinPet> = {
  codex: {
    displayName: 'Codex',
    description: 'The original Codex companion',
    spritesheetFile: 'codex-spritesheet-v4.webp'
  },
  dewey: {
    displayName: 'Dewey',
    description: 'A tidy duck for calm workspace days',
    spritesheetFile: 'dewey-spritesheet-v4.webp'
  },
  fireball: {
    displayName: 'Fireball',
    description: 'Hot path energy for fast iteration',
    spritesheetFile: 'fireball-spritesheet-v4.webp'
  },
  rocky: {
    displayName: 'Rocky',
    description: 'A steady rock when the diff gets large',
    spritesheetFile: 'rocky-spritesheet-v4.webp'
  },
  seedy: {
    displayName: 'Seedy',
    description: 'Small green shoots for new ideas',
    spritesheetFile: 'seedy-spritesheet-v4.webp'
  },
  stacky: {
    displayName: 'Stacky',
    description: 'A balanced stack for deep work',
    spritesheetFile: 'stacky-spritesheet-v4.webp'
  },
  bsod: {
    displayName: 'BSOD',
    description: 'A tiny blue-screen gremlin',
    spritesheetFile: 'bsod-spritesheet-v4.webp'
  },
  'null-signal': {
    displayName: 'Null Signal',
    description: 'Quiet signal from the void',
    spritesheetFile: 'null-signal-spritesheet-v4.webp'
  }
}

const FALLBACK_SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">'
  + '<rect x="5" y="7" width="54" height="46" rx="13" fill="#18181b"/>'
  + '<path d="M18 25l8 7-8 7M31 39h15" fill="none" stroke="#fafafa" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<circle cx="50" cy="14" r="5" fill="#22c55e"/>'
  + '</svg>',
  'utf8'
)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const boundedString = (value: unknown, maximum: number) =>
  typeof value === 'string' && value.trim() && value.trim().length <= maximum
    ? value.trim()
    : null

const sha256 = (value: Uint8Array | string) =>
  createHash('sha256').update(value).digest('hex')

const appStateFrames = (
  rowIndex: number,
  frameCount: number,
  frameDurationMs: number,
  finalFrameDurationMs: number
) => Array.from({ length: frameCount }, (_, columnIndex) => ({
  spriteIndex: rowIndex * DEFAULT_COLUMNS + columnIndex,
  durationMs: columnIndex === frameCount - 1 ? finalFrameDurationMs : frameDurationMs
}))

const idleFrames = (): ServerAvatarFrame[] =>
  [1680, 660, 660, 840, 840, 1920].map((durationMs, spriteIndex) => ({
    spriteIndex,
    durationMs
  }))

const loopingAnimation = (frames: ServerAvatarFrame[]): ServerAvatarAnimation => ({
  frames,
  loopStart: 0,
  fallback: 'idle'
})

const stateAnimation = (
  rowIndex: number,
  frameCount: number,
  frameDurationMs: number,
  finalFrameDurationMs: number
): ServerAvatarAnimation => {
  const primary = appStateFrames(
    rowIndex,
    frameCount,
    frameDurationMs,
    finalFrameDurationMs
  )
  return {
    frames: [...primary, ...primary, ...idleFrames()],
    loopStart: primary.length * 2,
    fallback: 'idle'
  }
}

export const defaultServerAvatarAnimations = (): Record<string, ServerAvatarAnimation> => {
  const runningRight = stateAnimation(1, 8, 120, 220)
  const runningLeft = stateAnimation(2, 8, 120, 220)
  const waving = stateAnimation(3, 4, 140, 280)
  const jumping = stateAnimation(4, 5, 140, 280)
  const failed = stateAnimation(5, 8, 140, 240)
  const waiting = stateAnimation(6, 6, 150, 260)
  const running = stateAnimation(7, 6, 120, 220)
  const review = stateAnimation(8, 6, 150, 280)

  return {
    idle: loopingAnimation(idleFrames()),
    'running-right': runningRight,
    'running-left': runningLeft,
    waving,
    jumping,
    failed,
    waiting,
    running,
    review,
    move_right: runningRight,
    move_left: runningLeft,
    wave: waving,
    bounce: jumping,
    sad: failed
  }
}

const readBoundedFile = async (path: string, maximum: number) => {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size > maximum) {
    throw new Error('avatar file is missing or exceeds its size limit')
  }
  const bytes = await readFile(path)
  if (bytes.byteLength > maximum) {
    throw new Error('avatar file exceeds its size limit')
  }
  return bytes
}

const sniffImage = (bytes: Buffer) => {
  const png = bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const webp = bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  if (!png && !webp) {
    throw new Error('avatar spritesheet must be PNG or WebP')
  }

  const dimensions = imageSize(bytes)
  if (!dimensions.width || !dimensions.height) {
    throw new Error('avatar spritesheet dimensions are unavailable')
  }

  return {
    mimeType: png ? 'image/png' : 'image/webp',
    width: dimensions.width,
    height: dimensions.height
  }
}

const normalizeFrameSpec = (
  value: unknown,
  spriteVersionNumber: number | null
): FrameSpec => {
  const defaultRows = spriteVersionNumber === 2 ? DEFAULT_V2_ROWS : DEFAULT_V1_ROWS
  if (!isRecord(value)) {
    return {
      width: DEFAULT_FRAME_WIDTH,
      height: DEFAULT_FRAME_HEIGHT,
      columns: DEFAULT_COLUMNS,
      rows: defaultRows
    }
  }

  const width = value.width
  const height = value.height
  const columns = value.columns
  const rows = value.rows
  if (
    !Number.isInteger(width)
    || !Number.isInteger(height)
    || !Number.isInteger(columns)
    || !Number.isInteger(rows)
    || Number(width) <= 0
    || Number(height) <= 0
    || Number(columns) <= 0
    || Number(rows) <= 0
  ) {
    throw new Error('avatar frame dimensions and grid counts must be positive integers')
  }

  return {
    width: Number(width),
    height: Number(height),
    columns: Number(columns),
    rows: Number(rows)
  }
}

const validateFrameSpec = (
  frame: FrameSpec,
  image: { width: number, height: number }
) => {
  const frameCount = frame.columns * frame.rows
  if (
    !Number.isSafeInteger(frame.width * frame.columns)
    || !Number.isSafeInteger(frame.height * frame.rows)
    || !Number.isSafeInteger(frameCount)
    || frameCount > MAX_FRAMES
    || frame.width * frame.columns !== image.width
    || frame.height * frame.rows !== image.height
  ) {
    throw new Error('avatar frame grid does not match the spritesheet')
  }
  return frameCount
}

const normalizeAnimations = (
  value: unknown,
  frame: FrameSpec
): Record<string, ServerAvatarAnimation> => {
  const frameCount = frame.columns * frame.rows
  const defaults = defaultServerAvatarAnimations()
  const safeIdle: ServerAvatarAnimation = {
    frames: idleFrames()
      .filter(frame => frame.spriteIndex < frameCount),
    loopStart: 0,
    fallback: 'idle'
  }
  if (!isRecord(value) || Object.keys(value).length === 0) {
    return frame.columns === DEFAULT_COLUMNS
      && (frame.rows === DEFAULT_V1_ROWS || frame.rows === DEFAULT_V2_ROWS)
      ? defaults
      : { idle: safeIdle }
  }
  if (Object.keys(value).length > MAX_ANIMATION_COUNT) {
    throw new Error('avatar manifest contains too many animations')
  }

  const animations: Record<string, ServerAvatarAnimation> = {}
  for (const [name, rawAnimation] of Object.entries(value)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name) || !isRecord(rawAnimation)) {
      throw new Error('avatar animation name or definition is invalid')
    }
    const rawFrames = rawAnimation.frames
    if (
      !Array.isArray(rawFrames)
      || rawFrames.length === 0
      || rawFrames.length > MAX_ANIMATION_FRAMES
      || !rawFrames.every(frame => Number.isInteger(frame) && Number(frame) >= 0 && Number(frame) < frameCount)
    ) {
      throw new Error('avatar animation contains invalid frames')
    }
    const fps = rawAnimation.fps === undefined ? 8 : Number(rawAnimation.fps)
    if (!Number.isFinite(fps) || fps <= 0 || fps > MAX_ANIMATION_FPS) {
      throw new Error('avatar animation fps is invalid')
    }
    const fallback = boundedString(rawAnimation.fallback, 64) ?? 'idle'
    const loop = rawAnimation.loop === undefined ? true : rawAnimation.loop === true
    const durationMs = Math.max(1, Math.round(1000 / fps))
    animations[name] = {
      frames: rawFrames.map(spriteIndex => ({
        spriteIndex: Number(spriteIndex),
        durationMs
      })),
      loopStart: loop ? 0 : null,
      fallback
    }
  }

  if (!animations.idle) {
    animations.idle = safeIdle
  }
  for (const animation of Object.values(animations)) {
    if (!animations[animation.fallback]) {
      throw new Error('avatar animation fallback is missing')
    }
  }
  return animations
}

const safeCustomPetId = (value: string) => {
  const id = value.startsWith('custom:') ? value.slice('custom:'.length) : value
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(id) && id !== '.' && id !== '..'
    ? id
    : null
}

const resolveContainedFile = async (directory: string, relativePath: string) => {
  if (
    !relativePath
    || relativePath.includes('\0')
    || relativePath.includes('\\')
    || isAbsolute(relativePath)
    || relativePath.split('/').some(segment => segment === '..')
  ) {
    throw new Error('avatar spritesheet path must stay inside its manifest directory')
  }

  const canonicalDirectory = await realpath(directory)
  const canonicalFile = await realpath(resolve(directory, relativePath))
  if (!isPathInsideDirectory(canonicalFile, canonicalDirectory)) {
    throw new Error('avatar spritesheet escaped its manifest directory')
  }
  return canonicalFile
}

const fetchBuiltinSpritesheet = async (
  fetcher: FetchLike,
  spritesheetFile: string
) => {
  if (!/^[a-z0-9-]+-spritesheet-v[0-9]+\.webp$/.test(spritesheetFile)) {
    throw new Error('built-in avatar filename is not allowlisted')
  }
  const url = `${PET_CDN_ORIGIN}${PET_CDN_PATH}${spritesheetFile}`
  const response = await fetcher(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(PET_FETCH_TIMEOUT_MS)
  })
  const finalUrl = new URL(response.url || url)
  if (
    !response.ok
    || finalUrl.origin !== PET_CDN_ORIGIN
    || !finalUrl.pathname.startsWith(PET_CDN_PATH)
    || finalUrl.pathname !== `${PET_CDN_PATH}${spritesheetFile}`
  ) {
    throw new Error('built-in avatar download failed validation')
  }
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > MAX_SPRITE_BYTES) {
    throw new Error('built-in avatar download exceeds its size limit')
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.byteLength > MAX_SPRITE_BYTES) {
    throw new Error('built-in avatar download exceeds its size limit')
  }
  return bytes
}

const fallbackAvatar = (
  serverId: string,
  serverLabel: string
): ResolvedServerAvatar => ({
  metadata: {
    serverId,
    serverLabel,
    avatarId: 'codori-fallback',
    source: 'fallback',
    displayName: 'Codori',
    description: 'Fallback Codori companion',
    revision: sha256(FALLBACK_SVG),
    mimeType: 'image/svg+xml',
    frame: {
      width: 64,
      height: 64,
      columns: 1,
      rows: 1,
      frameCount: 1
    },
    animations: {
      idle: {
        frames: [{ spriteIndex: 0, durationMs: 1000 }],
        loopStart: 0,
        fallback: 'idle'
      }
    }
  },
  bytes: FALLBACK_SVG,
  watchPath: null
})

export class ServerAvatarResolver {
  private readonly fetcher: FetchLike
  private readonly serverLabel: string
  private readonly cache = new Map<string, ResolvedServerAvatar>()

  constructor(options?: {
    fetcher?: FetchLike
    serverLabel?: string
  }) {
    this.fetcher = options?.fetcher ?? globalThis.fetch
    this.serverLabel = options?.serverLabel ?? hostname()
  }

  serverId(codexHome: string) {
    return `server-${sha256(`codori-avatar-v1\0${this.serverLabel}\0${codexHome}`).slice(0, 20)}`
  }

  invalidate(codexHome: string) {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${codexHome}\0`)) {
        this.cache.delete(key)
      }
    }
  }

  async resolve(codexHome: string, selectedAvatarId: string | null) {
    const selection = boundedString(selectedAvatarId, 160) ?? 'codex'
    const cacheKey = `${codexHome}\0${selection}`
    const cached = this.cache.get(cacheKey)
    if (cached) {
      return cached
    }

    const serverId = this.serverId(codexHome)
    let resolvedAvatar: ResolvedServerAvatar
    try {
      const builtin = BUILTIN_PETS[selection]
      resolvedAvatar = builtin
        ? await this.resolveBuiltin(codexHome, selection, builtin, serverId)
        : await this.resolveCustom(codexHome, selection, serverId)
    } catch {
      resolvedAvatar = fallbackAvatar(serverId, this.serverLabel)
    }
    this.cache.set(cacheKey, resolvedAvatar)
    return resolvedAvatar
  }

  private async resolveBuiltin(
    codexHome: string,
    id: string,
    builtin: BuiltinPet,
    serverId: string
  ): Promise<ResolvedServerAvatar> {
    const cachedPath = join(
      codexHome,
      'cache',
      'tui-pets',
      'v1',
      'assets',
      builtin.spritesheetFile
    )
    let bytes: Buffer
    try {
      bytes = await readBoundedFile(cachedPath, MAX_SPRITE_BYTES)
    } catch {
      bytes = await fetchBuiltinSpritesheet(this.fetcher, builtin.spritesheetFile)
    }
    const image = sniffImage(bytes)
    if (
      image.width !== DEFAULT_FRAME_WIDTH * DEFAULT_COLUMNS
      || image.height !== DEFAULT_FRAME_HEIGHT * DEFAULT_V1_ROWS
    ) {
      throw new Error('built-in avatar spritesheet dimensions are invalid')
    }

    return {
      metadata: {
        serverId,
        serverLabel: this.serverLabel,
        avatarId: id,
        source: 'builtin',
        displayName: builtin.displayName,
        description: builtin.description,
        revision: sha256(bytes),
        mimeType: image.mimeType,
        frame: {
          width: DEFAULT_FRAME_WIDTH,
          height: DEFAULT_FRAME_HEIGHT,
          columns: DEFAULT_COLUMNS,
          rows: DEFAULT_V1_ROWS,
          frameCount: DEFAULT_COLUMNS * DEFAULT_V1_ROWS
        },
        animations: defaultServerAvatarAnimations()
      },
      bytes,
      watchPath: null
    }
  }

  private async resolveCustom(
    codexHome: string,
    selection: string,
    serverId: string
  ): Promise<ResolvedServerAvatar> {
    const id = safeCustomPetId(selection)
    if (!id || selection === 'disabled') {
      throw new Error('custom avatar selection is invalid')
    }

    const candidates = [
      {
        directory: join(codexHome, 'pets', id),
        manifestName: 'pet.json',
        source: 'custom' as const
      },
      {
        directory: join(codexHome, 'avatars', id),
        manifestName: 'avatar.json',
        source: 'legacy' as const
      }
    ]
    for (const candidate of candidates) {
      try {
        const manifestPath = await resolveContainedFile(
          candidate.directory,
          candidate.manifestName
        )
        const manifestBytes = await readBoundedFile(manifestPath, MAX_MANIFEST_BYTES)
        const manifest = JSON.parse(manifestBytes.toString('utf8')) as AvatarManifest
        if (!isRecord(manifest)) {
          throw new Error('avatar manifest must be an object')
        }
        const spritePath = await resolveContainedFile(
          candidate.directory,
          boundedString(manifest.spritesheetPath, 240) ?? 'spritesheet.webp'
        )
        const bytes = await readBoundedFile(spritePath, MAX_SPRITE_BYTES)
        const image = sniffImage(bytes)
        const spriteVersionNumber = Number.isInteger(manifest.spriteVersionNumber)
          ? Number(manifest.spriteVersionNumber)
          : null
        if (spriteVersionNumber !== null && spriteVersionNumber !== 1 && spriteVersionNumber !== 2) {
          throw new Error('avatar sprite version is unsupported')
        }
        const frame = normalizeFrameSpec(manifest.frame, spriteVersionNumber)
        const frameCount = validateFrameSpec(frame, image)
        const manifestId = boundedString(manifest.id, 128)
        const displayName = boundedString(manifest.displayName, 160)
          ?? manifestId
          ?? id
        const description = boundedString(manifest.description, 500) ?? ''

        return {
          metadata: {
            serverId,
            serverLabel: this.serverLabel,
            avatarId: manifestId ?? id,
            source: candidate.source,
            displayName,
            description,
            revision: sha256(bytes),
            mimeType: image.mimeType,
            frame: {
              ...frame,
              frameCount
            },
            animations: normalizeAnimations(manifest.animations, frame)
          },
          bytes,
          watchPath: await realpath(candidate.directory)
        }
      } catch {
        // Try the legacy directory only after the current pet directory is absent
        // or invalid. The caller ultimately falls back without leaking local paths.
      }
    }

    throw new Error('custom avatar is unavailable')
  }
}

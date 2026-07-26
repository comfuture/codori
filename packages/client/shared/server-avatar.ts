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
  source: 'builtin' | 'custom' | 'legacy' | 'fallback'
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

export type ServerAvatarReadResponse = {
  avatar: ServerAvatarMetadata
}

export type ServerAvatarSpritesResponse = {
  avatarId: string
  revision: string
  mimeType: string
  data: string
}

export type ServerAvatarChangedNotification = {
  serverId: string
}

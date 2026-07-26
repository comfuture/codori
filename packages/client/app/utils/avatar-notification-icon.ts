import type { ServerAvatarMetadata } from '~~/shared/server-avatar'

const iconCache = new Map<string, Promise<string | null>>()

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = () => reject(new Error('Unable to load the server avatar icon.'))
  image.src = url
})

export const renderAvatarNotificationIcon = (
  avatar: ServerAvatarMetadata,
  spriteUrl: string
) => {
  const key = `${avatar.serverId}:${avatar.avatarId}:${avatar.revision}`
  const cached = iconCache.get(key)
  if (cached) {
    return cached
  }

  const rendered = (async () => {
    try {
      const image = await loadImage(spriteUrl)
      const firstFrame = avatar.animations.idle?.frames[0]
        ?? Object.values(avatar.animations)[0]?.frames[0]
      if (!firstFrame) {
        return null
      }
      const canvas = document.createElement('canvas')
      canvas.width = 96
      canvas.height = 104
      const context = canvas.getContext('2d')
      if (!context) {
        return null
      }
      context.imageSmoothingEnabled = false
      const column = firstFrame.spriteIndex % avatar.frame.columns
      const row = Math.floor(firstFrame.spriteIndex / avatar.frame.columns)
      context.drawImage(
        image,
        column * avatar.frame.width,
        row * avatar.frame.height,
        avatar.frame.width,
        avatar.frame.height,
        0,
        0,
        canvas.width,
        canvas.height
      )
      return canvas.toDataURL('image/png')
    } catch {
      return null
    }
  })()
  iconCache.set(key, rendered)
  return rendered
}

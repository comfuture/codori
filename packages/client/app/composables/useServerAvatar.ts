import { ref, type Ref } from 'vue'
import type { CodexRpcClient, CodexRpcConnectionState } from '~~/shared/codex-rpc'
import type {
  ServerAvatarChangedNotification,
  ServerAvatarMetadata,
  ServerAvatarReadResponse,
  ServerAvatarSpritesResponse
} from '~~/shared/server-avatar'

type AvatarResource = {
  avatar: Ref<ServerAvatarMetadata | null>
  spriteUrl: Ref<string | null>
  loading: Ref<boolean>
  error: Ref<string | null>
  consumers: number
  started: boolean
  refreshSequence: number
  releaseNotification: (() => void) | null
  releaseConnection: (() => void) | null
}

const resources = new WeakMap<CodexRpcClient, AvatarResource>()

const decodeBase64 = (value: string) => {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

const replaceSpriteUrl = (resource: AvatarResource, nextUrl: string | null) => {
  const previous = resource.spriteUrl.value
  resource.spriteUrl.value = nextUrl
  if (previous) {
    URL.revokeObjectURL(previous)
  }
}

const refreshResource = async (client: CodexRpcClient, resource: AvatarResource) => {
  const sequence = ++resource.refreshSequence
  resource.loading.value = true
  resource.error.value = null
  try {
    const read = await client.request<ServerAvatarReadResponse>('codori/avatar/read')
    const sprites = await client.request<ServerAvatarSpritesResponse>('codori/avatar/sprites', {
      avatarId: read.avatar.avatarId,
      revision: read.avatar.revision
    })
    if (
      sequence !== resource.refreshSequence
      || sprites.avatarId !== read.avatar.avatarId
      || sprites.revision !== read.avatar.revision
    ) {
      return
    }

    const blob = new Blob([decodeBase64(sprites.data)], {
      type: sprites.mimeType
    })
    replaceSpriteUrl(resource, URL.createObjectURL(blob))
    resource.avatar.value = read.avatar
  } catch (error) {
    if (sequence !== resource.refreshSequence) {
      return
    }
    resource.error.value = error instanceof Error ? error.message : String(error)
  } finally {
    if (sequence === resource.refreshSequence) {
      resource.loading.value = false
    }
  }
}

const startResource = (client: CodexRpcClient, resource: AvatarResource) => {
  if (resource.started) {
    return
  }
  resource.started = true
  resource.releaseNotification = client.subscribe((notification) => {
    if (notification.method !== 'codori/avatar/changed') {
      return
    }
    const params = notification.params as ServerAvatarChangedNotification
    if (!resource.avatar.value || params.serverId === resource.avatar.value.serverId) {
      void refreshResource(client, resource)
    }
  })
  resource.releaseConnection = client.subscribeConnectionState((state: CodexRpcConnectionState) => {
    if (state === 'connected' && resource.avatar.value) {
      void client.request('codori/avatar/watch').catch(() => {})
    }
  })
  void (async () => {
    await refreshResource(client, resource)
    await client.request('codori/avatar/watch').catch(() => {})
  })()
}

const stopResource = (client: CodexRpcClient, resource: AvatarResource) => {
  resource.refreshSequence += 1
  resource.releaseNotification?.()
  resource.releaseNotification = null
  resource.releaseConnection?.()
  resource.releaseConnection = null
  resource.started = false
  void client.request('codori/avatar/unwatch').catch(() => {})
  replaceSpriteUrl(resource, null)
  resource.avatar.value = null
  resources.delete(client)
}

export const acquireServerAvatar = (client: CodexRpcClient) => {
  let resource = resources.get(client)
  if (!resource) {
    resource = {
      avatar: ref(null),
      spriteUrl: ref(null),
      loading: ref(false),
      error: ref(null),
      consumers: 0,
      started: false,
      refreshSequence: 0,
      releaseNotification: null,
      releaseConnection: null
    }
    resources.set(client, resource)
  }
  resource.consumers += 1
  startResource(client, resource)

  let released = false
  return {
    avatar: resource.avatar,
    spriteUrl: resource.spriteUrl,
    loading: resource.loading,
    error: resource.error,
    refresh: () => refreshResource(client, resource),
    release: () => {
      if (released) {
        return
      }
      released = true
      resource.consumers -= 1
      if (resource.consumers === 0) {
        stopResource(client, resource)
      }
    }
  }
}

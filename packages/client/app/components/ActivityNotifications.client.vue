<script setup lang="ts">
import { h, onBeforeUnmount } from 'vue'
import { useToast } from '@nuxt/ui/composables'
import ServerActivityToastContent from './ServerActivityToastContent.vue'
import { useSystemNotifications } from '../composables/useSystemNotifications'
import {
  observeRpcWorkspaceClients,
  type RpcWorkspaceClient
} from '../composables/useRpc'
import { acquireServerAvatar } from '../composables/useServerAvatar'
import { useChats } from '../composables/useChats'
import { useCodoriRoute } from '../composables/useCodoriRoute'
import { useCodoriRouter } from '../composables/useCodoriRouter'
import { useProjects } from '../composables/useProjects'
import {
  compactNotificationText,
  extractActivityNotificationCandidate,
  selectActivityNotificationSurface
} from '../utils/activity-notifications'
import { renderAvatarNotificationIcon } from '../utils/avatar-notification-icon'
import { areThreadWorkspacePathsEqual } from '../utils/codex-thread-discovery'
import type { ThreadReadResponse } from '~~/shared/generated/codex-app-server/v2/ThreadReadResponse'
import { toChatRoute, toProjectThreadRoute } from '~~/shared/codori'

const toast = useToast()
const route = useCodoriRoute()
const router = useCodoriRouter()
const { enabled: systemNotificationsEnabled } = useSystemNotifications()
const { getProject } = useProjects()
const { getChat } = useChats()
const releases = new Map<string, () => void>()
const seenItems = new Set<string>()

const routeProjectId = () => {
  const value = route.params.projectId
  return Array.isArray(value)
    ? value.join('/')
    : typeof value === 'string' ? value : null
}

const routeThreadId = () =>
  typeof route.params.threadId === 'string' ? route.params.threadId : null

const routeChatId = () =>
  typeof route.params.chatId === 'string' ? route.params.chatId : null

const isViewingThread = (entry: RpcWorkspaceClient, threadId: string) =>
  entry.workspace.kind === 'chat'
    ? routeChatId() === entry.workspace.id
    : routeProjectId() === entry.workspace.id && routeThreadId() === threadId

const notificationRoute = (entry: RpcWorkspaceClient, threadId: string) =>
  entry.workspace.kind === 'chat'
    ? toChatRoute(entry.workspace.id)
    : toProjectThreadRoute(entry.workspace.id, threadId)

const hydrateNotificationThread = async (
  entry: RpcWorkspaceClient,
  threadId: string
) => {
  const response = await entry.client.request<ThreadReadResponse>('thread/read', {
    threadId,
    includeTurns: false
  })
  if (entry.workspace.kind === 'chat') {
    const chat = getChat(entry.workspace.id)
    if (!chat?.threadId || chat.threadId !== threadId) {
      return null
    }
  } else {
    const project = getProject(entry.workspace.id)
    if (
      !project
      || typeof response.thread.cwd !== 'string'
      || !areThreadWorkspacePathsEqual(response.thread.cwd, project.projectPath)
    ) {
      return null
    }
  }
  return response.thread
}

const subscribeWorkspace = (entry: RpcWorkspaceClient) => {
  const key = `${entry.workspace.kind}:${entry.workspace.id}`
  if (releases.has(key)) {
    return
  }
  const avatarResource = acquireServerAvatar(entry.client)
  const releaseNotification = entry.client.subscribe((notification) => {
    const candidate = extractActivityNotificationCandidate(notification)
    if (!candidate) {
      return
    }
    const dedupeKey = `${key}:${candidate.turnId}:${candidate.itemId}`
    if (seenItems.has(dedupeKey)) {
      return
    }
    seenItems.add(dedupeKey)
    if (seenItems.size > 500) {
      seenItems.delete(seenItems.values().next().value!)
    }

    void (async () => {
      let thread
      try {
        thread = await hydrateNotificationThread(entry, candidate.threadId)
      } catch {
        return
      }
      if (!thread) {
        return
      }

      const surface = selectActivityNotificationSurface({
        documentVisible: document.visibilityState === 'visible',
        windowFocused: document.hasFocus(),
        viewingThread: isViewingThread(entry, candidate.threadId),
        systemNotificationsEnabled: systemNotificationsEnabled.value
          && 'Notification' in window
          && Notification.permission === 'granted'
      })
      if (surface === 'none') {
        return
      }

      const target = notificationRoute(entry, candidate.threadId)
      const workspaceTitle = entry.workspace.kind === 'chat'
        ? (getChat(entry.workspace.id)?.title || 'Chat')
        : entry.workspace.id
      const threadTitle = thread.name || thread.preview || workspaceTitle
      const title = `${threadTitle} is ready`
      const message = compactNotificationText(candidate.text)
      const navigate = () => {
        window.focus()
        void router.push(target)
      }

      if (surface === 'toast') {
        toast.add({
          title: () => h(ServerActivityToastContent, {
            avatar: avatarResource.avatar.value,
            spriteUrl: avatarResource.spriteUrl.value,
            title,
            message
          }),
          duration: 8000,
          color: 'neutral',
          onClick: navigate,
          actions: [{
            label: 'Open',
            color: 'neutral',
            variant: 'outline',
            onClick: navigate
          }]
        })
        return
      }

      const icon = avatarResource.avatar.value && avatarResource.spriteUrl.value
        ? await renderAvatarNotificationIcon(
            avatarResource.avatar.value,
            avatarResource.spriteUrl.value
          )
        : null
      try {
        const systemNotification = new Notification(title, {
          body: message,
          tag: `codori:${key}:${candidate.threadId}`,
          ...(icon ? { icon } : {})
        })
        systemNotification.onclick = () => {
          systemNotification.close()
          navigate()
        }
      } catch {
        // Permission and constructor behavior vary by browser. Background
        // alerts remain optional and never fall back to a hidden-tab toast.
      }
    })()
  })

  releases.set(key, () => {
    releaseNotification()
    avatarResource.release()
  })
}

const releaseObserver = observeRpcWorkspaceClients(subscribeWorkspace)

onBeforeUnmount(() => {
  releaseObserver()
  for (const release of releases.values()) {
    release()
  }
  releases.clear()
})
</script>

<template>
  <span
    class="hidden"
    aria-hidden="true"
  />
</template>

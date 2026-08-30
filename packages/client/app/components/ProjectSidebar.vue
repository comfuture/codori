<script setup lang="ts">
import type { NavigationMenuItem } from '@nuxt/ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChats } from '../composables/useChats'
import { useCodoriRoute } from '../composables/useCodoriRoute'
import { useCodoriRouter } from '../composables/useCodoriRouter'
import { useProjects } from '../composables/useProjects'
import { useRpc } from '../composables/useRpc'
import {
  resolveProjectThreadSummaryKey,
  resolveThreadSummaryTitle,
  useThreadSummaries,
  isThreadSummaryRunning,
  type ThreadSummary
} from '../composables/useThreadSummaries'
import {
  extractThreadDiscoveryHints,
  normalizeThreadRunningState
} from '../utils/codex-thread-discovery'
import { isMacLikePlatform } from '../utils/global-command-palette-shortcut'
import { sortSidebarProjects } from '../utils/project-sidebar-order'
import type { ThreadListParams } from '~~/shared/generated/codex-app-server/v2/ThreadListParams'
import type { ThreadListResponse } from '~~/shared/generated/codex-app-server/v2/ThreadListResponse'
import type { ThreadReadParams } from '~~/shared/generated/codex-app-server/v2/ThreadReadParams'
import type { ThreadReadResponse } from '~~/shared/generated/codex-app-server/v2/ThreadReadResponse'
import type { ThreadSourceKind } from '~~/shared/generated/codex-app-server/v2/ThreadSourceKind'
import type { CodexRpcClient, CodexRpcConnectionState, CodexRpcNotification } from '~~/shared/codex-rpc'
import {
  notificationThreadId,
  notificationThreadName,
  notificationThreadUpdatedAt
} from '~~/shared/codex-rpc'
import {
  resolveProjectDisplayName,
  toChatRoute,
  toChatsRoute,
  toProjectRoute,
  toProjectThreadRoute
} from '~~/shared/codori'

const INLINE_THREAD_PAGE_SIZE = 5
const INLINE_LEGACY_THREAD_CURSOR = '__codori_legacy_project_threads__'
const INLINE_THREAD_SOURCE_KINDS: ThreadSourceKind[] = [
  'cli',
  'vscode',
  'exec',
  'appServer',
  'subAgent',
  'subAgentReview',
  'subAgentCompact',
  'subAgentThreadSpawn',
  'subAgentOther',
  'unknown'
]
const CHAT_ROOT_NAVIGATION_VALUE = 'chat-root'
const projectNavigationValue = (projectId: string) => `project:${projectId}`

const props = defineProps<{
  collapsed?: boolean
}>()
const emit = defineEmits<{
  openCommandPalette: []
}>()
type ProjectNavigationItem = NavigationMenuItem & {
  itemKind: 'project'
  projectId: string
  projectName: string
  projectPath: string
  error: string | null
}

type ProjectThreadNavigationItem = NavigationMenuItem & {
  itemKind: 'thread'
  projectId: string
  threadId: string
  title: string
  updatedAt: number
  running: boolean
  statusLabel: string | null
}

type ProjectThreadMoreNavigationItem = NavigationMenuItem & {
  itemKind: 'more'
  projectId: string
}

type ProjectThreadStatusNavigationItem = NavigationMenuItem & {
  itemKind: 'thread-status'
  projectId: string
  message: string
}

type ProjectSidebarNavigationItem =
  | ProjectNavigationItem
  | ProjectThreadNavigationItem
  | ProjectThreadMoreNavigationItem
  | ProjectThreadStatusNavigationItem

type ChatNavigationItem = NavigationMenuItem & {
  itemKind: 'chat'
  chatId: string
  title: string | null
  createdAt: number
  updatedAt: number | null
}

type ChatRootNavigationItem = NavigationMenuItem & {
  itemKind: 'chat-root'
  chatCount: number
  children: ChatNavigationItem[]
}

type ChatSidebarNavigationItem =
  | ChatRootNavigationItem
  | ChatNavigationItem

const route = useCodoriRoute()
const router = useCodoriRouter()
const addProjectOpen = ref(false)
const platform = ref(typeof navigator === 'undefined' ? '' : navigator.platform)
const isMac = computed(() => isMacLikePlatform(platform.value))
const inlineThreadsProjectId = ref<string | null>(null)
const inlineThreadsLoading = ref(false)
const inlineThreadsError = ref<string | null>(null)
const inlineThreadsNextCursor = ref<string | null>(null)
const inlineThreadsPageSource = ref<'project' | 'legacy'>('project')
let inlineThreadFetchSequence = 0
let inlineThreadSubscriptionSequence = 0
let inlineThreadSubscriptionKey: string | null = null
let releaseInlineThreadNotificationSubscription: (() => void) | null = null
let releaseInlineThreadConnectionSubscription: (() => void) | null = null
const liveInlineThreadIds = new Set<string>()
const suppressedInlineThreadIds = new Set<string>()
const inlineThreadHydrations = new Map<string, Promise<void>>()
const inlineThreadActiveTurnIds = new Map<string, string>()
const {
  projects,
  loaded,
  loading,
  refreshProjects,
  startProject,
  getProject
} = useProjects()
const { getClient } = useRpc()
const {
  chats,
  loaded: chatsLoaded,
  loading: chatsLoading,
  createPending: chatCreatePending,
  deletePendingId: chatDeletePendingId,
  refreshChats,
  deleteChat
} = useChats()

const inlineThreadSummariesForProject = (projectId: string | null) =>
  useThreadSummaries(resolveProjectThreadSummaryKey(projectId))

const inlineThreads = computed<ThreadSummary[]>(() => {
  if (!inlineThreadsProjectId.value) {
    return []
  }

  return inlineThreadSummariesForProject(inlineThreadsProjectId.value).threads.value
})

const threadStatusLabel = (thread: ThreadSummary) => {
  if (thread.status.type !== 'active') {
    return null
  }

  if (thread.status.activeFlags.includes('waitingOnApproval')) {
    return 'Thread running, waiting for approval'
  }
  if (thread.status.activeFlags.includes('waitingOnUserInput')) {
    return 'Thread running, waiting for input'
  }
  return 'Thread running'
}

const activeProjectId = computed(() => {
  const param = route.params.projectId
  if (Array.isArray(param)) {
    return param.join('/')
  }
  return typeof param === 'string' ? param : null
})
const activeChatId = computed(() => {
  const param = route.params.chatId
  return typeof param === 'string' ? param : null
})
const activeThreadId = computed(() => {
  const param = route.params.threadId
  return typeof param === 'string' ? param : null
})
const openChatNavigationValues = ref<string[]>([])
const openProjectNavigationValues = ref<string[]>([])
const selectedProjectId = activeProjectId

watch(activeChatId, (chatId) => {
  if (chatId && !openChatNavigationValues.value.includes(CHAT_ROOT_NAVIGATION_VALUE)) {
    openChatNavigationValues.value = [...openChatNavigationValues.value, CHAT_ROOT_NAVIGATION_VALUE]
  }
}, { immediate: true })

watch([activeProjectId, activeThreadId], ([projectId]) => {
  openProjectNavigationValues.value = projectId
    ? [projectNavigationValue(projectId)]
    : []
}, { immediate: true })

const ACTIVE_NAVIGATION_ITEM_CLASS = 'font-semibold before:bg-primary/5'
const ACTIVE_NAVIGATION_ITEM_UI = {
  linkLeadingIcon: 'text-dimmed group-data-[state=open]:text-dimmed'
}

const navigationItemClass = (active: boolean) =>
  active ? ACTIVE_NAVIGATION_ITEM_CLASS : undefined
const navigationItemUi = (active: boolean) =>
  active ? ACTIVE_NAVIGATION_ITEM_UI : undefined
const navigationThreadItemUi = (active: boolean, running: boolean) => {
  if (!running) {
    return navigationItemUi(active)
  }

  return {
    linkLeadingIcon: [
      active ? ACTIVE_NAVIGATION_ITEM_UI.linkLeadingIcon : '',
      'animate-spin text-success group-data-[state=open]:text-success motion-reduce:animate-none'
    ].filter(Boolean).join(' ')
  }
}

const isActiveNavigationItem = (item: NavigationMenuItem) => item.active === true
const navigationTitleClass = (item: NavigationMenuItem) =>
  isActiveNavigationItem(item) ? 'font-semibold text-highlighted' : 'font-medium text-highlighted'
const navigationMetaClass = (item: NavigationMenuItem) =>
  isActiveNavigationItem(item) ? 'font-medium text-muted' : 'text-muted'
const navigationInlineTitleClass = (item: NavigationMenuItem) =>
  isActiveNavigationItem(item) ? 'font-semibold text-highlighted' : 'font-medium text-highlighted'

const releaseInlineThreadSubscriptions = () => {
  inlineThreadSubscriptionSequence += 1
  inlineThreadSubscriptionKey = null
  releaseInlineThreadNotificationSubscription?.()
  releaseInlineThreadNotificationSubscription = null
  releaseInlineThreadConnectionSubscription?.()
  releaseInlineThreadConnectionSubscription = null
  liveInlineThreadIds.clear()
  suppressedInlineThreadIds.clear()
  inlineThreadHydrations.clear()
  inlineThreadActiveTurnIds.clear()
}

const isCurrentInlineThreadSubscription = (projectId: string, sequence: number) =>
  inlineThreadSubscriptionSequence === sequence
  && inlineThreadSubscriptionKey === projectId
  && selectedProjectId.value === projectId
  && !props.collapsed

const hydrateInlineThread = (
  client: CodexRpcClient,
  projectId: string,
  threadId: string,
  subscriptionSequence: number,
  statusRevision = inlineThreadSummariesForProject(projectId).getStatusRevision()
) => {
  const hydrationKey = `${projectId}:${threadId}`
  const existingHydration = inlineThreadHydrations.get(hydrationKey)
  if (existingHydration) {
    return existingHydration
  }

  const hydration = (async () => {
    try {
      const response = await client.request<ThreadReadResponse>('thread/read', {
        threadId,
        includeTurns: false
      } satisfies ThreadReadParams)

      if (!isCurrentInlineThreadSubscription(projectId, subscriptionSequence)) {
        return
      }
      if (suppressedInlineThreadIds.has(threadId)) {
        return
      }
      const summaries = inlineThreadSummariesForProject(projectId)
      if (response.thread.projectId !== projectId) {
        return
      }

      liveInlineThreadIds.add(threadId)
      summaries.syncThreadSummary(response.thread, {
        statusRevision
      })
    } catch {
      // Discovery is opportunistic. A thread can disappear between the lifecycle
      // notification and thread/read, and unrelated-project ids are filtered after hydration.
    }
  })()

  inlineThreadHydrations.set(hydrationKey, hydration)
  void hydration.finally(() => {
    if (inlineThreadHydrations.get(hydrationKey) === hydration) {
      inlineThreadHydrations.delete(hydrationKey)
    }
  })
  return hydration
}

const applyInlineThreadNotification = (
  notification: CodexRpcNotification,
  client: CodexRpcClient,
  projectId: string,
  subscriptionSequence: number
) => {
  if (!isCurrentInlineThreadSubscription(projectId, subscriptionSequence)) {
    return
  }

  const summaries = inlineThreadSummariesForProject(projectId)
  const hints = extractThreadDiscoveryHints(notification)
  const lifecycleThreadId = notificationThreadId(notification)

  if (notification.method === 'thread/project/updated') {
    const params = notification.params as { threadId?: unknown, projectId?: unknown }
    if (typeof params.threadId === 'string') {
      if (params.projectId !== projectId) {
        suppressedInlineThreadIds.add(params.threadId)
        liveInlineThreadIds.delete(params.threadId)
        inlineThreadActiveTurnIds.delete(params.threadId)
        summaries.removeThreadSummary(params.threadId)
      } else {
        suppressedInlineThreadIds.delete(params.threadId)
        void hydrateInlineThread(client, projectId, params.threadId, subscriptionSequence)
      }
    }
    return
  }

  if (
    lifecycleThreadId
    && (notification.method === 'thread/archived' || notification.method === 'thread/deleted')
  ) {
    suppressedInlineThreadIds.add(lifecycleThreadId)
    liveInlineThreadIds.delete(lifecycleThreadId)
    inlineThreadActiveTurnIds.delete(lifecycleThreadId)
    summaries.removeThreadSummary(lifecycleThreadId)
    return
  }
  if (lifecycleThreadId && notification.method === 'thread/unarchived') {
    suppressedInlineThreadIds.delete(lifecycleThreadId)
    void hydrateInlineThread(client, projectId, lifecycleThreadId, subscriptionSequence)
    return
  }

  if (hints.thread) {
    const thread = hints.thread
    if (thread.projectId !== undefined && thread.projectId !== projectId) {
      return
    }
    if (thread.projectId === projectId && typeof thread.updatedAt === 'number') {
      liveInlineThreadIds.add(thread.id)
      const statusRevision = summaries.getStatusRevision()
      if (thread.status !== undefined) {
        summaries.updateThreadSummaryStatus(thread.id, thread.status)
      }
      summaries.syncThreadSummary({
        id: thread.id,
        name: thread.name ?? null,
        preview: thread.preview ?? '',
        updatedAt: thread.updatedAt,
        status: thread.status
      }, {
        statusRevision
      })
    } else {
      void hydrateInlineThread(
        client,
        projectId,
        thread.id,
        subscriptionSequence
      )
    }
  }

  if (hints.statusUpdate) {
    const statusRevision = summaries.getStatusRevision()
    if (hints.statusUpdate.status) {
      summaries.updateThreadSummaryStatus(hints.statusUpdate.threadId, hints.statusUpdate.status)
    }
    if (!summaries.threads.value.some(thread => thread.id === hints.statusUpdate?.threadId)) {
      void hydrateInlineThread(
        client,
        projectId,
        hints.statusUpdate.threadId,
        subscriptionSequence,
        statusRevision
      )
    }
  }

  for (const threadId of hints.referencedThreadIds) {
    if (!summaries.threads.value.some(thread => thread.id === threadId)) {
      void hydrateInlineThread(client, projectId, threadId, subscriptionSequence)
    }
  }

  if (notification.method === 'thread/name/updated') {
    const threadId = notificationThreadId(notification)
    const threadName = notificationThreadName(notification)
    if (threadId && threadName) {
      if (summaries.threads.value.some(thread => thread.id === threadId)) {
        summaries.updateThreadSummaryTitle(
          threadId,
          threadName,
          notificationThreadUpdatedAt(notification)
        )
      } else {
        void hydrateInlineThread(client, projectId, threadId, subscriptionSequence)
      }
    }
  }

  const runningState = normalizeThreadRunningState(notification)
  if (runningState?.source === 'threadStatus' && !runningState.running) {
    inlineThreadActiveTurnIds.delete(runningState.threadId)
  }
  if (runningState?.source === 'turnLifecycle') {
    const existingThread = summaries.threads.value.find(thread => thread.id === runningState.threadId)
    const activeTurnId = inlineThreadActiveTurnIds.get(runningState.threadId)

    if (
      !runningState.running
      && activeTurnId
      && runningState.turnId
      && activeTurnId !== runningState.turnId
    ) {
      return
    }

    const statusRevision = summaries.getStatusRevision()
    if (runningState.running) {
      if (runningState.turnId) {
        inlineThreadActiveTurnIds.set(runningState.threadId, runningState.turnId)
      }
      summaries.updateThreadSummaryStatus(
        runningState.threadId,
        existingThread?.status.type === 'active'
          ? existingThread.status
          : { type: 'active', activeFlags: [] }
      )
    } else {
      inlineThreadActiveTurnIds.delete(runningState.threadId)
      summaries.updateThreadSummaryStatus(
        runningState.threadId,
        { type: 'idle' }
      )
    }

    // The app-server contract defines turn/started as actual execution start
    // and turn/completed as its terminal event. Hydration provides metadata;
    // the revision above keeps this live lifecycle evidence from being replaced
    // by an older thread/read response.
    if (!existingThread) {
      void hydrateInlineThread(
        client,
        projectId,
        runningState.threadId,
        subscriptionSequence,
        statusRevision
      )
    }
  }
}

const ensureInlineThreadSubscription = (
  client: CodexRpcClient,
  projectId: string
) => {
  if (inlineThreadSubscriptionKey === projectId) {
    return
  }

  releaseInlineThreadSubscriptions()
  inlineThreadSubscriptionKey = projectId
  const subscriptionSequence = inlineThreadSubscriptionSequence
  releaseInlineThreadNotificationSubscription = client.subscribe((notification) => {
    if (notification.method === 'project/changed') {
      void refreshProjects()
    }
    applyInlineThreadNotification(
      notification,
      client,
      projectId,
      subscriptionSequence
    )
  })

  let reconnectPending = false
  const connectionClient = client as CodexRpcClient & {
    subscribeConnectionState?: (listener: (state: CodexRpcConnectionState) => void) => () => void
  }
  if (typeof connectionClient.subscribeConnectionState === 'function') {
    releaseInlineThreadConnectionSubscription = connectionClient.subscribeConnectionState((state) => {
      if (state === 'disconnected') {
        reconnectPending = true
        return
      }
      if (state === 'connected' && reconnectPending) {
        reconnectPending = false
        void fetchInlineThreads()
      }
    })
  }
}

onMounted(() => {
  if (typeof navigator !== 'undefined') {
    platform.value = navigator.platform
  }
  if (!loaded.value) {
    void refreshProjects()
  }
  if (!chatsLoaded.value) {
    void refreshChats()
  }
  void fetchInlineThreads()
})

const resetInlineThreads = () => {
  releaseInlineThreadSubscriptions()
  inlineThreadFetchSequence += 1
  inlineThreadsProjectId.value = null
  inlineThreadsLoading.value = false
  inlineThreadsError.value = null
  inlineThreadsNextCursor.value = null
  inlineThreadsPageSource.value = 'project'
}

onBeforeUnmount(() => {
  releaseInlineThreadSubscriptions()
})

const waitForProjectsRefresh = async () => {
  if (loaded.value || !loading.value) {
    return
  }

  await new Promise<void>((resolve) => {
    const stop = watch([loaded, loading], ([projectsLoaded, projectsLoading]) => {
      if (projectsLoaded || !projectsLoading) {
        stop()
        resolve()
      }
    })
  })
}

const fetchInlineThreads = async (cursor: string | null = null) => {
  const projectId = selectedProjectId.value
  if (!projectId || props.collapsed) {
    resetInlineThreads()
    return
  }

  if (cursor && (
    inlineThreadsLoading.value
    || inlineThreadsProjectId.value !== projectId
    || inlineThreadsNextCursor.value !== cursor
  )) {
    return
  }

  const sequence = ++inlineThreadFetchSequence
  if (!cursor) {
    inlineThreadsProjectId.value = projectId
    inlineThreadsNextCursor.value = null
  }
  inlineThreadsLoading.value = true
  inlineThreadsError.value = null

  try {
    if (!loaded.value) {
      if (!loading.value) {
        await refreshProjects()
      }
      await waitForProjectsRefresh()
    }

    if (sequence !== inlineThreadFetchSequence) {
      return
    }

    const project = getProject(projectId)
    if (!project) {
      throw new Error(`Project "${projectId}" was not found.`)
    }

    if (project.status !== 'running') {
      await startProject(projectId)
    }

    if (sequence !== inlineThreadFetchSequence) {
      return
    }

    const client = getClient(projectId)
    ensureInlineThreadSubscription(client, projectId)
    const statusRevision = inlineThreadSummariesForProject(projectId).getStatusRevision()
    const projectRoots = (project.projectRoots?.length
      ? project.projectRoots
      : [project.projectPath]).filter(Boolean)
    const requestedSource = cursor === INLINE_LEGACY_THREAD_CURSOR
      ? 'legacy'
      : inlineThreadsPageSource.value
    const requestedCursor = cursor === INLINE_LEGACY_THREAD_CURSOR ? null : cursor
    const listThreads = (source: 'project' | 'legacy', pageCursor: string | null) =>
      client.request<ThreadListResponse>('thread/list', {
        ...(pageCursor ? { cursor: pageCursor } : {}),
        limit: INLINE_THREAD_PAGE_SIZE,
        sortKey: 'updated_at',
        sortDirection: 'desc',
        sourceKinds: INLINE_THREAD_SOURCE_KINDS,
        ...(source === 'project'
          ? { projectId }
          : {
              projectId: null,
              cwd: projectRoots.length === 1 ? projectRoots[0] : projectRoots
            })
      } satisfies ThreadListParams)
    let response = await listThreads(requestedSource, requestedCursor)
    let responseSource = requestedSource

    if (
      !cursor
      && responseSource === 'project'
      && response.data.length === 0
      && response.nextCursor === null
      && projectRoots.length > 0
    ) {
      response = await listThreads('legacy', null)
      responseSource = 'legacy'
    }

    if (sequence !== inlineThreadFetchSequence) {
      return
    }

    inlineThreadsPageSource.value = responseSource
    inlineThreadsNextCursor.value = response.nextCursor
      ?? (responseSource === 'project' && projectRoots.length > 0
        ? INLINE_LEGACY_THREAD_CURSOR
        : null)

    const nextThreads = response.data.map(thread => ({
      id: thread.id,
      title: resolveThreadSummaryTitle(thread),
      updatedAt: thread.updatedAt,
      status: thread.status
    }))
    const summaries = inlineThreadSummariesForProject(projectId)
    if (cursor) {
      const seenThreadIds = new Set(summaries.threads.value.map(thread => thread.id))
      summaries.setThreads([
        ...summaries.threads.value,
        ...nextThreads.filter(thread => !seenThreadIds.has(thread.id))
      ], { statusRevision })
    } else {
      const seenThreadIds = new Set(nextThreads.map(thread => thread.id))
      summaries.setThreads([
        ...nextThreads,
        ...summaries.threads.value.filter(thread =>
          liveInlineThreadIds.has(thread.id) && !seenThreadIds.has(thread.id)
        )
      ], { statusRevision })
    }
  } catch (caughtError) {
    if (sequence !== inlineThreadFetchSequence) {
      return
    }
    inlineThreadsError.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
  } finally {
    if (sequence === inlineThreadFetchSequence) {
      inlineThreadsLoading.value = false
    }
  }
}

watch([
  selectedProjectId,
  () => props.collapsed
], () => {
  void fetchInlineThreads()
})

const loadMoreInlineThreads = () => {
  const cursor = inlineThreadsNextCursor.value
  if (!cursor || inlineThreadsLoading.value) {
    return
  }

  void fetchInlineThreads(cursor)
}

const formatChatTitle = (chat: { chatId: string, title: string | null }) =>
  chat.title?.trim() || chat.chatId || 'New Chat'

const formatChatDate = (chat: { createdAt: number | null }) => {
  if (!chat.createdAt) {
    return 'Date unavailable'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(chat.createdAt))
}

const startChat = async () => {
  await router.push(toChatsRoute())
}

const removeChat = async (chatId: string) => {
  await deleteChat(chatId)
  if (activeChatId.value === chatId) {
    await router.push('/')
  }
}

const startProjectThread = async (projectId: string) => {
  await router.push(toProjectRoute(projectId))
}

const chatItems = computed<ChatSidebarNavigationItem[][]>(() => {
  const children = chats.value.map((chat) => {
    const active = activeChatId.value === chat.chatId
    return {
      itemKind: 'chat' as const,
      value: `chat:${chat.chatId}`,
      label: formatChatTitle(chat),
      icon: 'i-lucide-message-square',
      to: toChatRoute(chat.chatId),
      active,
      class: navigationItemClass(active),
      ui: navigationItemUi(active),
      tooltip: {
        text: chat.chatId
      },
      chatId: chat.chatId,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt
    }
  })

  return [[{
    itemKind: 'chat-root',
    value: CHAT_ROOT_NAVIGATION_VALUE,
    label: 'Projectless Chats',
    icon: 'i-lucide-messages-square',
    chatCount: children.length,
    children,
    tooltip: {
      text: 'Projectless Chats'
    }
  }]]
})

const projectItems = computed<ProjectSidebarNavigationItem[][]>(() => [
  sortSidebarProjects(projects.value, activeProjectId.value).map((project) => {
    const active = activeProjectId.value === project.projectId
    const projectName = resolveProjectDisplayName(project)
    const children: ProjectSidebarNavigationItem[] = []
    const item: ProjectNavigationItem = {
      itemKind: 'project',
      value: projectNavigationValue(project.projectId),
      label: projectName,
      icon: 'i-lucide-folder',
      active,
      class: navigationItemClass(active),
      ui: navigationItemUi(active),
      tooltip: {
        text: project.projectName ? `${project.projectName} (${project.projectId})` : project.projectId
      },
      to: toProjectRoute(project.projectId),
      projectId: project.projectId,
      projectName,
      projectPath: project.projectPath,
      error: project.error
    }

    if (props.collapsed || selectedProjectId.value !== project.projectId) {
      return item
    }

    if (inlineThreadsProjectId.value !== project.projectId) {
      return item
    }

    if (inlineThreadsLoading.value && !inlineThreads.value.length) {
      children.push({
        itemKind: 'thread-status',
        label: 'Loading threads...',
        icon: 'i-lucide-loader-circle',
        disabled: true,
        projectId: project.projectId,
        message: 'Loading threads...'
      })
      item.children = children
      return item
    }

    if (inlineThreadsError.value && !inlineThreads.value.length) {
      children.push({
        itemKind: 'thread-status',
        label: 'Threads unavailable',
        icon: 'i-lucide-circle-alert',
        disabled: true,
        projectId: project.projectId,
        message: inlineThreadsError.value
      })
      item.children = children
      return item
    }

    for (const thread of inlineThreads.value) {
      const active = activeThreadId.value === thread.id
      const running = isThreadSummaryRunning(thread.status)
      children.push({
        itemKind: 'thread',
        label: thread.title,
        ...(running ? { icon: 'i-lucide-loader-circle' } : {}),
        to: toProjectThreadRoute(project.projectId, thread.id),
        active,
        class: navigationItemClass(active),
        ui: navigationThreadItemUi(active, running),
        tooltip: {
          text: thread.title
        },
        projectId: project.projectId,
        threadId: thread.id,
        title: thread.title,
        updatedAt: thread.updatedAt,
        running,
        statusLabel: threadStatusLabel(thread)
      })
    }

    if (inlineThreadsError.value) {
      children.push({
        itemKind: 'thread-status',
        label: 'Could not load more threads',
        icon: 'i-lucide-circle-alert',
        disabled: true,
        projectId: project.projectId,
        message: `Could not load more threads: ${inlineThreadsError.value}`
      })
    }

    if (inlineThreadsNextCursor.value) {
      children.push({
        itemKind: 'more',
        label: 'Show more',
        projectId: project.projectId,
        disabled: inlineThreadsLoading.value,
        tooltip: {
          text: 'Load more threads'
        },
        onClick: loadMoreInlineThreads
      })
    }

    if (children.length) {
      item.children = children
    }

    return item
  })
])

const asProjectItem = (item: NavigationMenuItem) => item as ProjectNavigationItem
const asProjectSidebarItem = (item: NavigationMenuItem) => item as ProjectSidebarNavigationItem
const asProjectThreadItem = (item: NavigationMenuItem) => item as ProjectThreadNavigationItem
const asProjectThreadMoreItem = (item: NavigationMenuItem) => item as ProjectThreadMoreNavigationItem
const asProjectThreadStatusItem = (item: NavigationMenuItem) => item as ProjectThreadStatusNavigationItem
const asChatRootItem = (item: NavigationMenuItem) => item as ChatRootNavigationItem
const asChatItem = (item: NavigationMenuItem) => item as ChatNavigationItem

const isChatRootItem = (item: NavigationMenuItem): item is ChatRootNavigationItem =>
  (item as ChatSidebarNavigationItem).itemKind === 'chat-root'
const isChatItem = (item: NavigationMenuItem): item is ChatNavigationItem =>
  (item as ChatSidebarNavigationItem).itemKind === 'chat'
const isProjectItem = (item: NavigationMenuItem): item is ProjectNavigationItem =>
  asProjectSidebarItem(item).itemKind === 'project'
const isThreadItem = (item: NavigationMenuItem): item is ProjectThreadNavigationItem =>
  asProjectSidebarItem(item).itemKind === 'thread'
const isMoreItem = (item: NavigationMenuItem): item is ProjectThreadMoreNavigationItem =>
  asProjectSidebarItem(item).itemKind === 'more'
const isThreadStatusItem = (item: NavigationMenuItem): item is ProjectThreadStatusNavigationItem =>
  asProjectSidebarItem(item).itemKind === 'thread-status'
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="space-y-2">
      <UTooltip
        v-if="props.collapsed"
        text="Search Codori"
      >
        <UButton
          icon="i-lucide-search"
          color="neutral"
          variant="outline"
          size="xs"
          class="w-full justify-center gap-0.5 px-1"
          aria-label="Search Codori"
          @click="emit('openCommandPalette')"
        >
          <UKbd
            :value="isMac ? '⌘' : 'Ctrl'"
            size="sm"
          />
          <UKbd
            value="K"
            size="sm"
          />
        </UButton>
      </UTooltip>

      <UTooltip text="New Chat">
        <UButton
          icon="i-lucide-message-square-plus"
          color="primary"
          variant="soft"
          size="sm"
          :block="!props.collapsed"
          :square="props.collapsed"
          :label="props.collapsed ? undefined : 'New Chat'"
          :loading="chatCreatePending"
          aria-label="New Chat"
          @click="startChat"
        />
      </UTooltip>

      <UNavigationMenu
        v-if="chats.length"
        v-model="openChatNavigationValues"
        :items="chatItems"
        orientation="vertical"
        :collapsed="props.collapsed"
        highlight
        color="primary"
        variant="link"
        :popover="props.collapsed"
        :tooltip="props.collapsed"
        class="w-full"
        :ui="{
          root: 'w-full',
          list: 'gap-1',
          item: 'w-full',
          link: props.collapsed
            ? 'w-full justify-center rounded-lg px-2 py-2'
            : 'w-full rounded-lg px-3 py-2 text-sm',
          linkLeadingIcon: 'size-4',
          linkLabel: 'min-w-0 flex-1',
          linkTrailing: 'ms-3 shrink-0'
        }"
      >
        <template #item-label="{ item }">
          <div
            v-if="!props.collapsed && isChatRootItem(item)"
            class="min-w-0"
          >
            <div class="truncate font-medium text-highlighted">
              {{ asChatRootItem(item).label }}
            </div>
          </div>
          <div
            v-else-if="!props.collapsed && isChatItem(item)"
            class="min-w-0"
          >
            <div
              class="truncate"
              :class="navigationTitleClass(item)"
            >
              {{ asChatItem(item).title || asChatItem(item).label }}
            </div>
            <div
              class="truncate text-[11px]"
              :class="navigationMetaClass(item)"
            >
              {{ formatChatDate(asChatItem(item)) }}
            </div>
          </div>
        </template>

        <template #item-trailing="{ item }">
          <div
            v-if="!props.collapsed && isChatRootItem(item)"
            class="flex items-center gap-1 text-muted"
          >
            <span class="rounded-full bg-elevated px-2 py-0.5 text-[11px] font-medium">
              {{ asChatRootItem(item).chatCount }}
            </span>
            <UIcon
              name="i-lucide-chevron-down"
              class="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-180"
            />
          </div>
          <div
            v-else-if="!props.collapsed && isChatItem(item)"
            class="flex items-center"
          >
            <UTooltip text="Delete chat">
              <UButton
                icon="i-lucide-trash-2"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                :loading="chatDeletePendingId === asChatItem(item).chatId"
                aria-label="Delete chat"
                @click.prevent.stop="removeChat(asChatItem(item).chatId)"
              />
            </UTooltip>
          </div>
        </template>
      </UNavigationMenu>

      <div
        v-else-if="chatsLoading && !props.collapsed"
        class="px-3 py-1 text-xs text-muted"
      >
        Loading recent chats...
      </div>
    </div>

    <div class="flex items-center justify-between gap-2">
      <div
        v-if="!props.collapsed"
        class="text-xs font-medium text-muted"
      >
        Projects
      </div>
      <div class="flex items-center gap-1">
        <UTooltip text="Add project">
          <UButton
            icon="i-lucide-folder-plus"
            color="primary"
            variant="soft"
            size="xs"
            :square="props.collapsed"
            aria-label="Add project"
            @click="() => { addProjectOpen = true }"
          />
        </UTooltip>
      </div>
    </div>

    <div
      v-if="!projects.length && !loading"
      class="rounded-lg border border-dashed border-muted px-3 py-4 text-sm text-muted"
    >
      <span v-if="props.collapsed">0</span>
      <span v-else>No Git projects were discovered under the configured root.</span>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <UNavigationMenu
        v-model="openProjectNavigationValues"
        :items="projectItems"
        orientation="vertical"
        :collapsed="props.collapsed"
        highlight
        color="primary"
        variant="link"
        :popover="false"
        :tooltip="props.collapsed"
        class="w-full"
        :ui="{
          root: 'w-full',
          list: 'gap-1',
          item: 'w-full',
          link: props.collapsed
            ? 'w-full justify-center rounded-lg px-2 py-2'
            : 'w-full rounded-lg px-3 py-2.5 text-sm',
          linkLeadingIcon: 'size-4',
          linkLabel: 'min-w-0 flex-1',
          linkTrailing: 'ms-3 shrink-0'
        }"
      >
        <template #item-label="{ item }">
          <div
            v-if="!props.collapsed && isProjectItem(item)"
            class="min-w-0"
          >
            <div
              class="truncate"
              :class="navigationTitleClass(item)"
            >
              {{ asProjectItem(item).projectName }}
            </div>
            <div
              v-if="asProjectItem(item).error"
              class="truncate text-[11px] text-error"
            >
              {{ asProjectItem(item).error }}
            </div>
          </div>
          <div
            v-else-if="!props.collapsed && isThreadItem(item)"
            class="min-w-0 ps-2"
          >
            <div
              class="truncate text-xs"
              :class="navigationInlineTitleClass(item)"
            >
              {{ asProjectThreadItem(item).title }}
            </div>
          </div>
          <div
            v-else-if="!props.collapsed && isMoreItem(item)"
            class="min-w-0 ps-2"
          >
            <div class="truncate text-xs font-medium text-muted">
              {{ asProjectThreadMoreItem(item).label }}
            </div>
          </div>
          <div
            v-else-if="!props.collapsed && isThreadStatusItem(item)"
            class="min-w-0 ps-2"
          >
            <div
              class="truncate text-xs"
              :class="asProjectThreadStatusItem(item).message === 'Loading threads...' ? 'text-muted' : 'text-error'"
            >
              {{ asProjectThreadStatusItem(item).message }}
            </div>
          </div>
        </template>
        <template #item-trailing="{ item }">
          <div
            v-if="!props.collapsed && isProjectItem(item)"
            class="flex items-center transition-opacity"
            :class="isActiveNavigationItem(item) ? 'opacity-100' : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100'"
          >
            <UTooltip text="New thread">
              <UButton
                icon="i-lucide-message-square-plus"
                color="neutral"
                variant="ghost"
                size="xs"
                square
                :aria-label="`New thread in ${asProjectItem(item).projectName}`"
                @click.prevent.stop="startProjectThread(asProjectItem(item).projectId)"
              />
            </UTooltip>
          </div>
          <span
            v-if="!props.collapsed && isThreadItem(item) && asProjectThreadItem(item).running"
            role="status"
            :aria-label="asProjectThreadItem(item).statusLabel ?? 'Thread running'"
            :title="asProjectThreadItem(item).statusLabel ?? 'Thread running'"
            class="sr-only"
          >
            {{ asProjectThreadItem(item).statusLabel ?? 'Thread running' }}
          </span>
        </template>
      </UNavigationMenu>
    </div>

    <AddProjectModal v-model:open="addProjectOpen" />
  </div>
</template>

<script setup lang="ts">
import { useRoute, useRouter } from '#imports'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useChats } from '../../composables/useChats'
import { useChatSession } from '../../composables/useChatSession'
import { useVisualSubagentPanels } from '../../composables/useVisualSubagentPanels'
import {
  pruneExpandedSubagentThreadId,
  resolveExpandedSubagentPanel,
  resolveSubagentAccent,
  resolveSubagentPanelAutoOpen,
  toSubagentAvatarText
} from '~~/shared/subagent-panels'

const route = useRoute()
const router = useRouter()
const {
  chats,
  loaded,
  refreshChats,
  fetchChat,
  getChat
} = useChats()

const chatId = computed(() => {
  const value = route.params.chatId
  return typeof value === 'string' ? value : null
})
const selectedChat = computed(() => getChat(chatId.value))
const chatTitle = computed(() => selectedChat.value?.title?.trim() || 'New Chat')
const session = computed(() =>
  chatId.value ? useChatSession(`chat:${chatId.value}`) : null
)
const subagentPanels = computed(() =>
  session.value?.subagentPanels.value ?? []
)
const { availablePanels, activePanels } = useVisualSubagentPanels(() => subagentPanels.value)
const isSubagentsPanelOpen = ref(false)
const isMobileSubagentsDrawerOpen = ref(false)
const expandedSubagentThreadId = ref<string | null>(null)
const hasUserToggledSubagentsPanel = ref(false)
const hasResolvedSubagentPanelState = ref(false)
const previousActiveSubagentCount = ref(0)
const isMobileViewport = ref(true)
const hasAvailableSubagents = computed(() => availablePanels.value.length > 0)
const isDesktopSubagentsPanelVisible = computed(() =>
  !isMobileViewport.value && isSubagentsPanelOpen.value && hasAvailableSubagents.value
)
const isSubagentsSurfaceOpen = computed(() =>
  isMobileViewport.value ? isMobileSubagentsDrawerOpen.value : isDesktopSubagentsPanelVisible.value
)
const subagentsToggleLabel = computed(() =>
  isMobileViewport.value
    ? (isMobileSubagentsDrawerOpen.value ? 'Hide subagents' : 'Show subagents')
    : (isDesktopSubagentsPanelVisible.value ? 'Hide subagents' : 'Show subagents')
)
const subagentAvatarItems = computed(() =>
  availablePanels.value.map((panel, index) => ({
    threadId: panel.threadId,
    name: panel.name,
    text: toSubagentAvatarText(panel.name),
    class: resolveSubagentAccent(index).avatarClass
  }))
)
const expandedSubagentPanel = computed(() =>
  resolveExpandedSubagentPanel(availablePanels.value, expandedSubagentThreadId.value)
)
const expandedSubagentAccent = computed(() => {
  if (!expandedSubagentPanel.value) {
    return null
  }

  const index = availablePanels.value.findIndex(panel => panel.threadId === expandedSubagentPanel.value?.threadId)
  return index >= 0 ? resolveSubagentAccent(index) : null
})
const isExpandedSubagentOpen = computed({
  get: () => expandedSubagentPanel.value !== null,
  set: (open) => {
    if (!open) {
      expandedSubagentThreadId.value = null
    }
  }
})

let viewportQuery: MediaQueryList | null = null
let removeViewportListener: (() => void) | null = null

const syncViewportMode = (mobile: boolean) => {
  isMobileViewport.value = mobile

  if (mobile) {
    isSubagentsPanelOpen.value = false
    return
  }

  isMobileSubagentsDrawerOpen.value = false

  if (hasAvailableSubagents.value && !hasUserToggledSubagentsPanel.value && activePanels.value.length > 0) {
    isSubagentsPanelOpen.value = true
  }
}

const toggleSubagentsPanel = () => {
  if (!hasAvailableSubagents.value) {
    return
  }

  if (isMobileViewport.value) {
    isMobileSubagentsDrawerOpen.value = !isMobileSubagentsDrawerOpen.value
    return
  }

  hasUserToggledSubagentsPanel.value = true
  isSubagentsPanelOpen.value = !isSubagentsPanelOpen.value
}

const closeSubagentsPanel = () => {
  hasUserToggledSubagentsPanel.value = true
  isSubagentsPanelOpen.value = false
}

const openExpandedSubagent = (subagentThreadId: string) => {
  expandedSubagentThreadId.value = subagentThreadId
  isMobileSubagentsDrawerOpen.value = false
}

onMounted(async () => {
  if (!loaded.value) {
    await refreshChats()
  }

  if (chatId.value && !getChat(chatId.value)) {
    try {
      await fetchChat(chatId.value)
    } catch {
      if (chats.value.length > 0) {
        await router.push('/')
      }
    }
  }

  if (!import.meta.client) {
    return
  }

  viewportQuery = window.matchMedia('(max-width: 767px)')
  syncViewportMode(viewportQuery.matches)

  const handleViewportChange = (event: MediaQueryListEvent) => {
    syncViewportMode(event.matches)
  }

  viewportQuery.addEventListener('change', handleViewportChange)
  removeViewportListener = () => {
    viewportQuery?.removeEventListener('change', handleViewportChange)
  }
})

onBeforeUnmount(() => {
  removeViewportListener?.()
})

watch(chatId, () => {
  hasUserToggledSubagentsPanel.value = false
  hasResolvedSubagentPanelState.value = false
  previousActiveSubagentCount.value = 0
  isSubagentsPanelOpen.value = false
  isMobileSubagentsDrawerOpen.value = false
  expandedSubagentThreadId.value = null
}, { immediate: true })

watch(hasAvailableSubagents, (value) => {
  if (!value) {
    hasUserToggledSubagentsPanel.value = false
    hasResolvedSubagentPanelState.value = false
    previousActiveSubagentCount.value = 0
    isSubagentsPanelOpen.value = false
    isMobileSubagentsDrawerOpen.value = false
    expandedSubagentThreadId.value = null
  }
}, { immediate: true })

watch(availablePanels, (panels) => {
  expandedSubagentThreadId.value = pruneExpandedSubagentThreadId(panels, expandedSubagentThreadId.value)
}, { immediate: true })

watch(
  () => activePanels.value.length,
  (nextCount) => {
    const nextState = resolveSubagentPanelAutoOpen({
      isMobile: isMobileViewport.value,
      hasAvailableSubagents: hasAvailableSubagents.value,
      hasResolvedState: hasResolvedSubagentPanelState.value,
      hasUserToggled: hasUserToggledSubagentsPanel.value,
      previousActiveCount: previousActiveSubagentCount.value,
      nextActiveCount: nextCount
    })

    hasResolvedSubagentPanelState.value = nextState.hasResolvedState
    previousActiveSubagentCount.value = nextState.previousActiveCount

    if (nextState.nextOpen !== null) {
      isSubagentsPanelOpen.value = nextState.nextOpen
    }
  },
  { immediate: true }
)
</script>

<template>
  <div class="app-shell-height flex h-screen h-dvh min-h-0 flex-1 min-w-0">
    <UDashboardPanel
      id="chat-shell"
      class="min-h-0 min-w-0 flex-1"
      :default-size="isDesktopSubagentsPanelVisible ? 70 : undefined"
      :min-size="isDesktopSubagentsPanelVisible ? 50 : undefined"
      :max-size="isDesktopSubagentsPanelVisible ? 75 : undefined"
      :resizable="isDesktopSubagentsPanelVisible"
      :ui="{ root: '!p-0', body: '!p-0 sm:!p-0 !gap-0 sm:!gap-0' }"
    >
      <template #header>
        <UDashboardNavbar
          icon="i-lucide-message-square"
          :ui="{
            title: 'min-w-0 flex-1',
            left: 'min-w-0 flex-1',
            right: 'shrink-0'
          }"
        >
          <template #title>
            <div class="min-w-0 overflow-hidden pe-2">
              <div class="truncate text-sm font-medium text-highlighted">
                {{ chatTitle }}
              </div>
            </div>
          </template>
          <template #right>
            <UTooltip
              v-if="hasAvailableSubagents"
              text="Subagents"
            >
              <UButton
                :color="isSubagentsSurfaceOpen ? 'primary' : 'neutral'"
                :variant="isSubagentsSurfaceOpen ? 'soft' : 'ghost'"
                icon="i-lucide-bot"
                size="sm"
                class="px-2 xl:ps-2 xl:pe-2.5"
                :aria-label="subagentsToggleLabel"
                @click="toggleSubagentsPanel"
              >
                <UAvatarGroup
                  class="hidden xl:flex"
                  size="xs"
                  :max="4"
                  :ui="{ base: 'ring-2 -me-2 first:me-0' }"
                >
                  <UAvatar
                    v-for="agent in subagentAvatarItems"
                    :key="agent.threadId"
                    :text="agent.text"
                    :alt="agent.name"
                    :class="agent.class"
                  />
                </UAvatarGroup>
              </UButton>
            </UTooltip>
          </template>
        </UDashboardNavbar>
      </template>

      <template #body>
        <ChatWorkspace
          v-if="chatId"
          workspace-kind="chat"
          :chat-id="chatId"
          :thread-id="selectedChat?.threadId ?? null"
          class="min-h-0 flex-1"
        />
      </template>
    </UDashboardPanel>

    <UDashboardPanel
      v-if="isDesktopSubagentsPanelVisible"
      id="chat-subagents-panel"
      class="h-full min-h-0"
      :default-size="30"
      :min-size="20"
      :max-size="40"
      resizable
      :ui="{ header: '!p-0 bg-[var(--ui-bg)]', body: '!p-0' }"
    >
      <template #header>
        <div
          class="flex items-center justify-between gap-2 border-b border-default px-4 py-3"
          style="background-color: var(--ui-bg);"
        >
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-highlighted">Subagents</span>
            <UBadge
              color="primary"
              variant="soft"
              size="sm"
            >
              {{ availablePanels.length }}
            </UBadge>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            aria-label="Close subagents panel"
            @click="closeSubagentsPanel"
          />
        </div>
      </template>

      <template #body>
        <VisualSubagentStack
          :agents="availablePanels"
          class="h-full min-h-0"
          @expand="openExpandedSubagent"
        />
      </template>
    </UDashboardPanel>

    <UDrawer
      v-if="hasAvailableSubagents"
      v-model:open="isMobileSubagentsDrawerOpen"
      direction="bottom"
      :handle="true"
      :ui="{
        content: 'max-h-[85dvh] rounded-t-2xl md:hidden',
        container: 'gap-0 p-0',
        header: 'px-4 pb-2 pt-4',
        body: '!p-0',
        footer: 'hidden'
      }"
    >
      <template #header>
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <span class="text-sm font-semibold text-highlighted">Subagents</span>
            <UBadge
              color="primary"
              variant="soft"
              size="sm"
            >
              {{ availablePanels.length }}
            </UBadge>
          </div>
          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="xs"
            square
            aria-label="Close subagents drawer"
            @click="isMobileSubagentsDrawerOpen = false"
          />
        </div>
      </template>

      <template #body>
        <SubagentDrawerList
          :agents="availablePanels"
          @expand="openExpandedSubagent"
        />
      </template>
    </UDrawer>

    <UModal
      v-model:open="isExpandedSubagentOpen"
      fullscreen
      :ui="{
        header: 'hidden',
        close: 'hidden',
        content: 'overflow-hidden bg-default',
        body: '!h-full !p-0'
      }"
    >
      <template #body>
        <SubagentTranscriptPanel
          v-if="expandedSubagentPanel"
          :agent="expandedSubagentPanel"
          :accent="expandedSubagentAccent"
          scroll-scope="expanded"
          expanded
          show-collapse-button
          class="h-full"
          @collapse="expandedSubagentThreadId = null"
        />
      </template>
    </UModal>
  </div>
</template>

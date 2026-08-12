<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useActiveTurnWakeLock } from './composables/useActiveTurnWakeLock'
import { useHasActiveChatTurn } from './composables/useChatSession'

let visualViewportRef: VisualViewport | null = null
const hasActiveChatTurn = useHasActiveChatTurn()
useActiveTurnWakeLock(hasActiveChatTurn)

const setViewportHeightCssVar = () => {
  if (!import.meta.client) {
    return
  }

  const nextHeight = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty('--app-viewport-height', `${Math.round(nextHeight)}px`)
}

onMounted(() => {
  setViewportHeightCssVar()

  visualViewportRef = window.visualViewport
  visualViewportRef?.addEventListener('resize', setViewportHeightCssVar)
  window.addEventListener('resize', setViewportHeightCssVar)
  window.addEventListener('orientationchange', setViewportHeightCssVar)
})

onBeforeUnmount(() => {
  visualViewportRef?.removeEventListener('resize', setViewportHeightCssVar)
  window.removeEventListener('resize', setViewportHeightCssVar)
  window.removeEventListener('orientationchange', setViewportHeightCssVar)
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
    <ActivityNotifications />
    <GlobalRealtimeVoiceCompanion />
  </UApp>
</template>

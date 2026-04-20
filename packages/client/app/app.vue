<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'

let visualViewportRef: VisualViewport | null = null

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
  visualViewportRef?.addEventListener('scroll', setViewportHeightCssVar)
  window.addEventListener('resize', setViewportHeightCssVar)
  window.addEventListener('orientationchange', setViewportHeightCssVar)
})

onBeforeUnmount(() => {
  visualViewportRef?.removeEventListener('resize', setViewportHeightCssVar)
  visualViewportRef?.removeEventListener('scroll', setViewportHeightCssVar)
  window.removeEventListener('resize', setViewportHeightCssVar)
  window.removeEventListener('orientationchange', setViewportHeightCssVar)
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>

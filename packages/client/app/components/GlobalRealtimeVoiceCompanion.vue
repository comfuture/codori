<script setup lang="ts">
import { useRoute } from '#imports'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import RealtimeVoiceCompanion from './RealtimeVoiceCompanion.vue'
import { useRealtimeVoiceWakeLock } from '../composables/useRealtimeVoiceWakeLock'
import { useActiveRealtimeConversation } from '../composables/useSharedRealtimeConversation'
import {
  matchesLandingRealtimeVoicePresentation,
  useLandingRealtimeVoicePresentation
} from '../composables/useLandingRealtimeVoicePresentation'
import { acquireServerAvatar } from '../composables/useServerAvatar'
import { isRealtimeVoiceCompanionActive } from '../utils/realtime-voice-companion'
import type { ServerAvatarMetadata } from '~~/shared/server-avatar'

const realtimeVoice = useActiveRealtimeConversation()
const route = useRoute()
const landingPresentation = useLandingRealtimeVoicePresentation()
const companionState = computed(() =>
  realtimeVoice.sessionKind.value === 'preview' ? 'idle' : realtimeVoice.state.value
)
const centered = computed(() =>
  route.path === '/'
  && matchesLandingRealtimeVoicePresentation(
    landingPresentation.presentation.value,
    realtimeVoice.activeWorkspaceKey.value,
    realtimeVoice.activeThreadId.value
  )
)
useRealtimeVoiceWakeLock(companionState)
const avatar = ref<ServerAvatarMetadata | null>(null)
const spriteUrl = ref<string | null>(null)
let releaseAvatar: (() => void) | null = null

const releaseAvatarResource = () => {
  releaseAvatar?.()
  releaseAvatar = null
  avatar.value = null
  spriteUrl.value = null
}

const syncAvatarResource = () => {
  releaseAvatarResource()
  if (!isRealtimeVoiceCompanionActive(companionState.value)) {
    return
  }

  const client = realtimeVoice.activeClient.value
  if (!client) {
    return
  }

  const resource = acquireServerAvatar(client)
  const stopAvatar = watch(resource.avatar, (nextAvatar) => {
    avatar.value = nextAvatar
  }, { immediate: true })
  const stopSpriteUrl = watch(resource.spriteUrl, (nextSpriteUrl) => {
    spriteUrl.value = nextSpriteUrl
  }, { immediate: true })
  releaseAvatar = () => {
    stopAvatar()
    stopSpriteUrl()
    resource.release()
  }
}

watch([
  () => isRealtimeVoiceCompanionActive(realtimeVoice.state.value),
  realtimeVoice.sessionKind,
  realtimeVoice.activeClient
], syncAvatarResource, { immediate: true })

watch(companionState, (state) => {
  if (!isRealtimeVoiceCompanionActive(state)) {
    landingPresentation.clear()
  }
})

onBeforeUnmount(releaseAvatarResource)
</script>

<template>
  <RealtimeVoiceCompanion
    :avatar="avatar"
    :sprite-url="spriteUrl"
    :session-state="companionState"
    :activity="realtimeVoice.activity.value"
    :generation="realtimeVoice.generation.value"
    :transcripts="centered ? [] : realtimeVoice.transcripts.value"
    :bottom-offset="156"
    :presentation="centered ? 'centered' : 'floating'"
    :show-transcripts="!centered"
    @stop="void realtimeVoice.stop()"
  />
</template>

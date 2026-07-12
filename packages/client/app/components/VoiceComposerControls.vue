<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import type {
  RealtimeActivity,
  RealtimeCapability,
  RealtimeSessionState
} from '../composables/useRealtimeConversation'

const props = defineProps<{
  capability: RealtimeCapability
  sessionState: RealtimeSessionState
  activity: RealtimeActivity
  microphoneEnabled: boolean
  outputMuted: boolean
  autoplayBlocked: boolean
  latestUserTranscript: string | null
  error: string | null
}>()

const emit = defineEmits<{
  connect: []
  press: []
  release: []
  'toggle-output': []
  stop: []
}>()

let activePointerId: number | null = null
let activePointerTarget: HTMLElement | null = null
let activeKey: ' ' | 'Enter' | null = null
let pendingPressAfterConnect = false
let suppressNextClick = false
let transmissionRequested = false

const sessionActive = computed(() =>
  props.sessionState === 'requesting-permission'
  || props.sessionState === 'creating-offer'
  || props.sessionState === 'starting'
  || props.sessionState === 'connected'
  || props.sessionState === 'stopping'
)

const microphoneDisabled = computed(() =>
  props.capability.status !== 'available'
  || props.sessionState === 'stopping'
)

const statusLabel = computed(() => {
  if (props.sessionState === 'error') {
    return props.error || 'Voice session error'
  }
  if (props.autoplayBlocked) {
    return 'Remote speech is blocked. Use the speaker control to play it.'
  }
  if (props.sessionState === 'requesting-permission') {
    return 'Waiting for microphone permission'
  }
  if (props.sessionState === 'creating-offer' || props.sessionState === 'starting') {
    return 'Connecting voice session'
  }
  if (props.sessionState === 'stopping') {
    return 'Stopping voice session'
  }
  if (props.sessionState === 'closed') {
    return 'Voice session stopped'
  }
  if (props.sessionState !== 'connected') {
    if (props.sessionState === 'idle' && props.capability.status === 'available') {
      return 'Microphone permission required — start voice session'
    }
    return props.capability.message
  }

  switch (props.activity) {
    case 'listening':
      return 'Listening — release to mute'
    case 'transcribing':
      return 'Transcribing your request'
    case 'delegating':
      return 'Delegating to Codex'
    case 'working':
      return 'Codex is working'
    case 'speaking':
      return props.outputMuted ? 'Codex is speaking — output muted' : 'Codex is speaking'
    default:
      return props.outputMuted ? 'Voice ready — microphone and output muted' : 'Voice ready — microphone muted'
  }
})

const microphoneLabel = computed(() => {
  if (props.capability.status !== 'available') {
    return props.capability.message
  }
  if (props.sessionState === 'connected') {
    return props.microphoneEnabled ? 'Release to mute microphone' : 'Hold to talk'
  }
  if (sessionActive.value) {
    return 'Voice session is connecting'
  }
  return 'Start voice session'
})

const microphoneIcon = computed(() =>
  props.microphoneEnabled ? 'i-lucide-audio-lines' : 'i-lucide-mic'
)

const beginTransmission = () => {
  transmissionRequested = true
  emit('press')
}

const releaseTransmission = () => {
  pendingPressAfterConnect = false
  if (transmissionRequested || props.microphoneEnabled) {
    transmissionRequested = false
    emit('release')
  }
}

const clearPointer = (event?: PointerEvent) => {
  if (event && activePointerId !== event.pointerId) {
    return
  }
  const pointerId = activePointerId
  const pointerTarget = activePointerTarget
  activePointerId = null
  activePointerTarget = null
  if (pointerId !== null && pointerTarget?.hasPointerCapture?.(pointerId)) {
    pointerTarget.releasePointerCapture(pointerId)
  }
  releaseTransmission()
}

const handlePointerDown = (event: PointerEvent) => {
  if (microphoneDisabled.value || activePointerId !== null || (event.button !== 0 && event.pointerType !== 'touch')) {
    return
  }
  event.preventDefault()
  activePointerId = event.pointerId
  activePointerTarget = event.currentTarget as HTMLElement
  suppressNextClick = true
  activePointerTarget.setPointerCapture?.(event.pointerId)
  if (props.sessionState === 'connected') {
    beginTransmission()
  } else {
    pendingPressAfterConnect = true
    emit('connect')
  }
}

const handlePointerRelease = (event: PointerEvent) => {
  if (activePointerId !== event.pointerId) {
    return
  }
  event.preventDefault()
  clearPointer(event)
}

const handleKeyDown = (event: KeyboardEvent) => {
  if ((event.key !== ' ' && event.key !== 'Enter') || event.repeat || activeKey !== null || microphoneDisabled.value) {
    return
  }
  event.preventDefault()
  activeKey = event.key
  suppressNextClick = true
  if (props.sessionState === 'connected') {
    beginTransmission()
  } else {
    pendingPressAfterConnect = true
    emit('connect')
  }
}

const handleWindowKeyUp = (event: KeyboardEvent) => {
  if (activeKey !== event.key) {
    return
  }
  event.preventDefault()
  activeKey = null
  releaseTransmission()
}

const handleClick = (event: MouseEvent) => {
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }
  if (event.detail !== 0 || microphoneDisabled.value) {
    return
  }
  if (props.sessionState !== 'connected') {
    emit('connect')
    return
  }
  if (props.microphoneEnabled) {
    transmissionRequested = false
    emit('release')
  } else {
    beginTransmission()
  }
}

const releaseForLostFocus = () => {
  if (activePointerId !== null) {
    clearPointer()
  }
  activeKey = null
  releaseTransmission()
}

const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    releaseForLostFocus()
  }
}

watch(() => props.sessionState, (nextState) => {
  if (nextState === 'connected' && pendingPressAfterConnect && (activePointerId !== null || activeKey !== null)) {
    pendingPressAfterConnect = false
    beginTransmission()
    return
  }
  if (nextState === 'closed' || nextState === 'error' || nextState === 'idle') {
    releaseForLostFocus()
  }
})

onMounted(() => {
  window.addEventListener('keyup', handleWindowKeyUp)
  window.addEventListener('blur', releaseForLostFocus)
  window.addEventListener('pagehide', releaseForLostFocus)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})

onBeforeUnmount(() => {
  releaseForLostFocus()
  window.removeEventListener('keyup', handleWindowKeyUp)
  window.removeEventListener('blur', releaseForLostFocus)
  window.removeEventListener('pagehide', releaseForLostFocus)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-2">
    <UTooltip :text="microphoneLabel">
      <UButton
        type="button"
        :color="microphoneEnabled ? 'primary' : 'neutral'"
        :variant="microphoneEnabled ? 'soft' : 'ghost'"
        size="sm"
        :icon="microphoneIcon"
        :disabled="microphoneDisabled"
        :aria-label="microphoneLabel"
        :aria-pressed="microphoneEnabled"
        class="size-11 shrink-0 touch-none justify-center rounded-full border border-default/70 md:size-8"
        :ui="{ leadingIcon: 'size-4', base: 'px-0' }"
        @pointerdown="handlePointerDown"
        @pointerup="handlePointerRelease"
        @pointercancel="handlePointerRelease"
        @pointerleave="handlePointerRelease"
        @lostpointercapture="handlePointerRelease"
        @keydown="handleKeyDown"
        @click="handleClick"
      />
    </UTooltip>

    <UTooltip
      v-if="sessionActive"
      :text="outputMuted ? 'Unmute remote speech' : 'Mute remote speech'"
    >
      <UButton
        type="button"
        color="neutral"
        variant="ghost"
        size="sm"
        :icon="outputMuted ? 'i-lucide-volume-x' : 'i-lucide-volume-2'"
        :aria-label="autoplayBlocked ? 'Play and unmute remote speech' : outputMuted ? 'Unmute remote speech' : 'Mute remote speech'"
        :aria-pressed="outputMuted"
        class="size-11 shrink-0 justify-center rounded-full border border-default/70 md:size-8"
        :ui="{ leadingIcon: 'size-4', base: 'px-0' }"
        @click="emit('toggle-output')"
      />
    </UTooltip>

    <UTooltip
      v-if="sessionActive"
      text="Stop voice session"
    >
      <UButton
        type="button"
        color="error"
        variant="ghost"
        size="sm"
        icon="i-lucide-square"
        aria-label="Stop voice session"
        class="size-11 shrink-0 justify-center rounded-full border border-default/70 md:size-8"
        :ui="{ leadingIcon: 'size-4', base: 'px-0' }"
        @click="emit('stop')"
      />
    </UTooltip>

    <div
      class="min-w-32 max-w-full text-xs leading-5 text-toned"
      aria-live="polite"
      aria-atomic="true"
    >
      <div class="font-medium text-default">
        {{ statusLabel }}
      </div>
      <div
        v-if="latestUserTranscript"
        class="max-w-72 truncate text-muted"
      >
        Heard: {{ latestUserTranscript }}
      </div>
    </div>
  </div>
</template>

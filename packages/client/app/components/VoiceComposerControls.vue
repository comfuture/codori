<script setup lang="ts">
import { computed } from 'vue'
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
  error: string | null
}>()

const emit = defineEmits<{
  connect: []
  'toggle-microphone': []
  'toggle-output': []
  stop: []
}>()

const sessionActive = computed(() =>
  props.sessionState === 'requesting-permission'
  || props.sessionState === 'creating-offer'
  || props.sessionState === 'starting'
  || props.sessionState === 'connected'
  || props.sessionState === 'stopping'
)

const capabilityUnavailable = computed(() =>
  props.capability.status === 'disabled'
  || props.capability.status === 'unsupported'
  || props.capability.status === 'insecure-context'
  || props.capability.status === 'failed'
)

const microphoneDisabled = computed(() =>
  capabilityUnavailable.value
  || props.sessionState === 'requesting-permission'
  || props.sessionState === 'creating-offer'
  || props.sessionState === 'starting'
  || props.sessionState === 'stopping'
)

const showStatus = computed(() => sessionActive.value || props.sessionState === 'connected')

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
    return props.capability.message
  }

  switch (props.activity) {
    case 'listening':
      return 'Listening'
    case 'transcribing':
      return 'Transcribing your request'
    case 'delegating':
      return 'Delegating to Codex'
    case 'working':
      return 'Codex is working'
    case 'speaking':
      return props.outputMuted ? 'Codex is speaking — output muted' : 'Codex is speaking'
    default:
      if (props.microphoneEnabled) {
        return props.outputMuted ? 'Voice active — output muted' : 'Voice active'
      }
      return props.outputMuted ? 'Voice ready — microphone and output muted' : 'Voice ready — microphone muted'
  }
})

const microphoneLabel = computed(() => {
  if (props.sessionState === 'error') {
    return props.error || 'Voice session error'
  }
  if (capabilityUnavailable.value) {
    return props.capability.message
  }
  if (props.sessionState === 'connected') {
    return props.microphoneEnabled ? 'Deactivate microphone' : 'Activate microphone'
  }
  if (sessionActive.value) {
    return 'Voice session is connecting'
  }
  return 'Start voice session and activate microphone'
})

const microphoneIcon = computed(() =>
  capabilityUnavailable.value || props.sessionState === 'error'
    ? 'i-lucide-mic-off'
    : 'i-lucide-audio-lines'
)

const microphoneColor = computed(() =>
  capabilityUnavailable.value || props.sessionState === 'error'
    ? 'error'
    : props.microphoneEnabled
      ? 'primary'
      : 'neutral'
)

const microphoneVariant = computed(() =>
  capabilityUnavailable.value || props.sessionState === 'error' || props.microphoneEnabled
    ? 'soft'
    : 'ghost'
)

const handleClick = () => {
  if (microphoneDisabled.value) {
    return
  }
  if (props.sessionState !== 'connected') {
    emit('connect')
    return
  }
  emit('toggle-microphone')
}
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-2">
    <UTooltip :text="microphoneLabel">
      <span
        class="inline-flex shrink-0 rounded-full"
        :tabindex="capabilityUnavailable ? 0 : undefined"
        :aria-label="capabilityUnavailable ? microphoneLabel : undefined"
        :aria-disabled="capabilityUnavailable ? 'true' : undefined"
      >
        <UButton
          type="button"
          :color="microphoneColor"
          :variant="microphoneVariant"
          size="sm"
          :icon="microphoneIcon"
          :disabled="microphoneDisabled"
          :aria-label="microphoneLabel"
          :aria-pressed="microphoneEnabled"
          class="size-11 shrink-0 justify-center rounded-full border border-default/70 md:size-8"
          :ui="{ leadingIcon: 'size-4', base: 'px-0' }"
          @click="handleClick"
        />
      </span>
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
      v-if="showStatus"
      class="min-w-32 max-w-full text-xs leading-5 text-toned"
      aria-live="polite"
      aria-atomic="true"
    >
      <div class="font-medium text-default">
        {{ statusLabel }}
      </div>
    </div>
  </div>
</template>

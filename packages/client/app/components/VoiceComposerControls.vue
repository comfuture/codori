<script setup lang="ts">
import { computed } from 'vue'
import type {
  RealtimeActivity,
  RealtimeCapability,
  RealtimeSessionKind,
  RealtimeSessionState,
  RealtimeVoiceCatalog,
  RealtimeVoicePreviewStatus
} from '../composables/useRealtimeConversation'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'

const props = defineProps<{
  capability: RealtimeCapability
  sessionState: RealtimeSessionState
  activity: RealtimeActivity
  microphoneEnabled: boolean
  outputMuted: boolean
  autoplayBlocked: boolean
  error: string | null
  activeElsewhere: boolean
  voiceCatalog: RealtimeVoiceCatalog
  selectedVoice?: RealtimeVoice
  savedVoice: string | null
  sessionKind: RealtimeSessionKind | null
  activeVoice: RealtimeVoice | null
  previewStatus: RealtimeVoicePreviewStatus
  previewError: string | null
  hasMaterializedThread: boolean
}>()

const emit = defineEmits<{
  connect: []
  'toggle-microphone': []
  'toggle-output': []
  stop: []
  'select-voice': [voice: RealtimeVoice | null]
  'refresh-voices': []
  'preview-voice': [voice: RealtimeVoice]
  'stop-preview': []
}>()

const sessionActive = computed(() =>
  props.activeElsewhere
  || props.sessionState === 'requesting-permission'
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
  props.activeElsewhere
  || capabilityUnavailable.value
  || props.sessionState === 'requesting-permission'
  || props.sessionState === 'creating-offer'
  || props.sessionState === 'starting'
  || props.sessionState === 'stopping'
)

const showStatus = computed(() => sessionActive.value || props.sessionState === 'connected')

const statusLabel = computed(() => {
  if (props.activeElsewhere) {
    return 'Voice session active in another thread'
  }
  if (props.autoplayBlocked) {
    return props.sessionKind === 'preview'
      ? props.previewError || 'Browser autoplay blocked the voice preview. Interact with the page and retry.'
      : 'Remote speech is blocked. Use the speaker control to play it.'
  }
  if (props.sessionKind === 'preview' && sessionActive.value) {
    return props.activeVoice
      ? `Previewing ${props.activeVoice}`
      : 'Voice preview active'
  }
  if (props.sessionState === 'error') {
    return props.error || 'Voice session error'
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
  if (props.activeElsewhere) {
    return 'A voice session is already active in another thread'
  }
  if (props.sessionKind === 'preview' && sessionActive.value) {
    return 'Start voice conversation and stop preview'
  }
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
  props.activeElsewhere || capabilityUnavailable.value || props.sessionState === 'error'
    ? 'i-lucide-mic-off'
    : 'i-lucide-audio-lines'
)

const microphoneColor = computed(() =>
  props.activeElsewhere
    ? 'neutral'
    : capabilityUnavailable.value || props.sessionState === 'error'
    ? 'error'
    : props.microphoneEnabled
      ? 'primary'
      : 'neutral'
)

const microphoneVariant = computed(() =>
  props.activeElsewhere || capabilityUnavailable.value || props.sessionState === 'error' || props.microphoneEnabled
    ? 'soft'
    : 'ghost'
)

const handleClick = () => {
  if (microphoneDisabled.value) {
    return
  }
  if (props.sessionState !== 'connected' || props.sessionKind === 'preview') {
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
        :tabindex="capabilityUnavailable || activeElsewhere ? 0 : undefined"
        :aria-label="capabilityUnavailable || activeElsewhere ? microphoneLabel : undefined"
        :aria-disabled="capabilityUnavailable || activeElsewhere ? 'true' : undefined"
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

    <RealtimeVoicePicker
      :capability="capability"
      :catalog="voiceCatalog"
      :selected-voice="selectedVoice"
      :saved-voice="savedVoice"
      :session-kind="sessionKind"
      :session-state="sessionState"
      :active-voice="activeVoice"
      :preview-status="previewStatus"
      :preview-error="previewError"
      :active-elsewhere="activeElsewhere"
      :has-materialized-thread="hasMaterializedThread"
      @select="emit('select-voice', $event)"
      @refresh="emit('refresh-voices')"
      @preview="emit('preview-voice', $event)"
      @stop-preview="emit('stop-preview')"
    />

    <UTooltip
      v-if="sessionActive && !activeElsewhere"
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
      :text="sessionKind === 'preview' ? 'Stop voice preview' : 'Stop voice session'"
    >
      <UButton
        type="button"
        color="error"
        variant="ghost"
        size="sm"
        icon="i-lucide-square"
        :aria-label="sessionKind === 'preview' ? 'Stop voice preview' : 'Stop voice session'"
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

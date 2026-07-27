<script setup lang="ts">
import { computed, nextTick, useId } from 'vue'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'
import type {
  RealtimeCapability,
  RealtimeSessionKind,
  RealtimeSessionState,
  RealtimeVoiceCatalog,
  RealtimeVoicePreviewStatus
} from '../composables/useRealtimeConversation'

const props = defineProps<{
  capability: RealtimeCapability
  catalog: RealtimeVoiceCatalog
  selectedVoice?: RealtimeVoice
  savedVoice: string | null
  sessionKind: RealtimeSessionKind | null
  sessionState: RealtimeSessionState
  activeVoice: RealtimeVoice | null
  previewStatus: RealtimeVoicePreviewStatus
  previewError: string | null
  activeElsewhere: boolean
  hasWorkspaceContext: boolean
}>()

const emit = defineEmits<{
  select: [voice: RealtimeVoice | null]
  preview: [voice: RealtimeVoice]
  'stop-preview': []
  refresh: []
}>()

const radioName = `realtime-voice-${useId()}`
const activeSession = computed(() =>
  props.sessionState === 'requesting-permission'
  || props.sessionState === 'creating-offer'
  || props.sessionState === 'starting'
  || props.sessionState === 'connected'
  || props.sessionState === 'stopping'
)
const normalSessionActive = computed(() =>
  props.activeElsewhere
  || (props.sessionKind === 'conversation' && activeSession.value)
)
const capabilityUnavailable = computed(() =>
  props.capability.status !== 'available'
  && props.capability.status !== 'checking'
)
const staleSavedVoice = computed(() =>
  props.catalog.status === 'ready'
  && props.savedVoice !== null
  && props.selectedVoice === undefined
)
const savedPreferenceLabel = computed(() =>
  props.savedVoice ?? 'Use Codex setting'
)
const previewStatusText = computed(() => {
  if (props.previewStatus === 'loading') {
    return props.activeVoice
      ? `Loading ${props.activeVoice} preview`
      : 'Loading voice preview'
  }
  if (props.previewStatus === 'playing') {
    return props.activeVoice
      ? `Playing ${props.activeVoice} preview`
      : 'Playing voice preview'
  }
  if (props.previewStatus === 'blocked') {
    return props.previewError
      || 'Browser autoplay blocked this preview. Interact with the page and retry.'
  }
  if (props.previewStatus === 'stopping') {
    return 'Stopping voice preview'
  }
  if (props.previewStatus === 'error') {
    return props.previewError || 'Voice preview failed'
  }
  return ''
})

const previewUnavailableReason = computed(() => {
  if (normalSessionActive.value) {
    return 'Preview is unavailable during a voice conversation.'
  }
  if (!props.hasWorkspaceContext) {
    return 'Open an existing thread before Settings to preview voices without creating hidden history.'
  }
  if (capabilityUnavailable.value) {
    return props.capability.message
  }
  return null
})

const isPreviewing = (voice: RealtimeVoice) =>
  props.sessionKind === 'preview'
  && props.activeVoice === voice
  && activeSession.value

const handlePreview = (voice: RealtimeVoice) => {
  if (previewUnavailableReason.value) {
    return
  }
  if (isPreviewing(voice)) {
    emit('stop-preview')
    return
  }
  emit('preview', voice)
}

const handleRadioKeydown = async (event: KeyboardEvent, currentIndex: number) => {
  const optionCount = props.catalog.voices.length + 1
  let nextIndex: number | null = null
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
    nextIndex = (currentIndex + 1) % optionCount
  } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
    nextIndex = (currentIndex - 1 + optionCount) % optionCount
  } else if (event.key === 'Home') {
    nextIndex = 0
  } else if (event.key === 'End') {
    nextIndex = optionCount - 1
  }
  if (nextIndex === null) {
    return
  }

  event.preventDefault()
  const fieldset = (event.currentTarget as HTMLElement).closest('fieldset')
  emit('select', nextIndex === 0 ? null : props.catalog.voices[nextIndex - 1]!)
  await nextTick()
  fieldset?.querySelectorAll<HTMLInputElement>('input[type="radio"]')[nextIndex]?.focus()
}
</script>

<template>
  <div>
    <div class="grid gap-2 border-b border-default py-6 sm:grid-cols-[12rem_1fr] sm:gap-6">
      <div>
        <h3 class="text-sm font-medium text-highlighted">
          Saved preference
        </h3>
        <p class="mt-1 text-xs leading-5 text-muted">
          Stored only in this browser.
        </p>
      </div>
      <div class="text-sm text-toned">
        {{ savedPreferenceLabel }}
      </div>
    </div>

    <div class="border-b border-default py-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 class="text-sm font-medium text-highlighted">
            Voice for new conversations
          </h3>
          <p class="mt-1 text-sm leading-6 text-muted">
            Changes apply to the next conversation and never hot-swap an active session.
          </p>
        </div>
        <UButton
          v-if="hasWorkspaceContext"
          type="button"
          color="neutral"
          variant="outline"
          size="sm"
          icon="i-lucide-refresh-cw"
          label="Refresh voices"
          :loading="catalog.status === 'loading'"
          @click="emit('refresh')"
        />
      </div>

      <div
        v-if="!hasWorkspaceContext"
        class="mt-5 border-s-2 border-warning ps-4 text-sm leading-6 text-warning"
        role="status"
      >
        No materialized thread context is available. Your saved preference remains readable, but Codori will not create a thread or connect a hidden workspace just to discover voices. Open an existing thread, then return to Settings.
      </div>

      <div
        v-else-if="capabilityUnavailable"
        class="mt-5 border-s-2 border-error ps-4 text-sm leading-6 text-error"
        role="alert"
      >
        {{ capability.message }}
      </div>

      <div
        v-else-if="catalog.status === 'loading' || catalog.status === 'idle'"
        class="mt-5 flex items-center gap-2 text-sm text-toned"
        role="status"
      >
        <UIcon
          name="i-lucide-loader-circle"
          class="size-4 animate-spin"
        />
        Loading voices from Codex
      </div>

      <div
        v-else-if="catalog.status === 'error'"
        class="mt-5 flex flex-col gap-3 border-s-2 border-error ps-4 text-sm text-error sm:flex-row sm:items-center sm:justify-between"
        role="alert"
      >
        <span>{{ catalog.error || 'Realtime voices are unavailable.' }}</span>
        <UButton
          type="button"
          color="error"
          variant="soft"
          size="xs"
          aria-label="Retry loading realtime voices"
          @click="emit('refresh')"
        >
          Retry
        </UButton>
      </div>

      <fieldset
        v-else
        class="mt-5 divide-y divide-default border-y border-default"
      >
        <legend class="sr-only">
          Realtime voice override
        </legend>
        <label class="flex min-h-14 cursor-pointer items-center gap-3 py-3 text-sm">
          <input
            type="radio"
            :name="radioName"
            value=""
            class="sr-only"
            :tabindex="selectedVoice === undefined ? 0 : -1"
            :checked="selectedVoice === undefined"
            @change="emit('select', null)"
            @keydown="handleRadioKeydown($event, 0)"
          >
          <UIcon
            :name="selectedVoice === undefined ? 'i-lucide-circle-check' : 'i-lucide-circle'"
            class="size-4 shrink-0"
            :class="selectedVoice === undefined ? 'text-primary' : 'text-muted'"
          />
          <span class="min-w-0 flex-1">
            <span class="block text-highlighted">Use Codex setting</span>
            <span class="mt-0.5 block text-xs text-muted">Send no per-session voice override.</span>
          </span>
        </label>

        <label
          v-for="voice in catalog.voices"
          :key="voice"
          class="flex min-h-14 cursor-pointer items-center gap-3 py-3 text-sm"
        >
          <input
            type="radio"
            :name="radioName"
            :value="voice"
            class="sr-only"
            :tabindex="selectedVoice === voice ? 0 : -1"
            :checked="selectedVoice === voice"
            @change="emit('select', voice)"
            @keydown="handleRadioKeydown($event, catalog.voices.indexOf(voice) + 1)"
          >
          <UIcon
            :name="selectedVoice === voice ? 'i-lucide-circle-check' : 'i-lucide-circle'"
            class="size-4 shrink-0"
            :class="selectedVoice === voice ? 'text-primary' : 'text-muted'"
          />
          <span class="min-w-0 flex-1 truncate text-highlighted">{{ voice }}</span>
          <UBadge
            v-if="catalog.protocolDefault === voice"
            color="neutral"
            variant="soft"
            size="sm"
          >
            Protocol default
          </UBadge>
          <UBadge
            v-if="savedVoice === voice"
            color="primary"
            variant="soft"
            size="sm"
          >
            Saved
          </UBadge>
        </label>

        <p
          v-if="catalog.voices.length === 0"
          class="py-5 text-sm text-muted"
        >
          Codex did not advertise any V3-compatible voices.
        </p>
      </fieldset>

      <p
        v-if="staleSavedVoice"
        class="mt-4 border-s-2 border-warning ps-4 text-sm leading-6 text-warning"
      >
        Saved voice “{{ savedVoice }}” is not advertised by this Codex server. The value is preserved for diagnostics, and Codex settings will be used safely.
      </p>
    </div>

    <div class="py-6">
      <h3 class="text-sm font-medium text-highlighted">
        Voice previews
      </h3>
      <p class="mt-1 text-sm leading-6 text-muted">
        Previews use a receive-only session on the remembered thread. They do not request microphone access or add conversation history.
      </p>

      <div
        v-if="catalog.voices.length > 0"
        class="mt-4 flex flex-wrap gap-2"
      >
        <UTooltip
          v-for="voice in catalog.voices"
          :key="`preview-${voice}`"
          :text="previewUnavailableReason || (isPreviewing(voice) ? `Stop ${voice} preview` : `Preview ${voice}`)"
        >
          <UButton
            type="button"
            color="neutral"
            :variant="isPreviewing(voice) ? 'soft' : 'outline'"
            size="sm"
            :icon="isPreviewing(voice) ? 'i-lucide-square' : 'i-lucide-play'"
            :loading="activeVoice === voice && previewStatus === 'loading'"
            :disabled="Boolean(previewUnavailableReason)"
            :aria-label="isPreviewing(voice) ? `Stop preview for ${voice}` : `Preview voice ${voice}`"
            @click="handlePreview(voice)"
          >
            {{ voice }}
          </UButton>
        </UTooltip>
      </div>

      <p
        v-if="previewUnavailableReason"
        class="mt-4 text-sm leading-6 text-muted"
      >
        {{ previewUnavailableReason }}
      </p>
      <p
        v-if="previewStatusText"
        class="mt-4 text-sm text-toned"
        :class="previewStatus === 'error' || previewStatus === 'blocked' ? 'text-error' : ''"
        aria-live="polite"
        aria-atomic="true"
      >
        {{ previewStatusText }}
      </p>
    </div>
  </div>
</template>

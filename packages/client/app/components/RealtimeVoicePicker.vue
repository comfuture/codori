<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import type { RealtimeVoice } from '~~/shared/generated/codex-app-server/RealtimeVoice'
import type {
  RealtimeSessionKind,
  RealtimeSessionState,
  RealtimeCapability,
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
  hasMaterializedThread: boolean
}>()

const emit = defineEmits<{
  select: [voice: RealtimeVoice | null]
  preview: [voice: RealtimeVoice]
  'stop-preview': []
  refresh: []
}>()

const open = ref(false)
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
  &&
  props.savedVoice !== null
  && props.selectedVoice === undefined
)
const triggerLabel = computed(() =>
  props.selectedVoice ?? 'Codex setting'
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
  if (capabilityUnavailable.value) {
    return props.capability.message
  }
  if (!props.hasMaterializedThread) {
    return 'Open an existing thread to preview voices without creating hidden history.'
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

watch(open, (isOpen) => {
  if (isOpen && !capabilityUnavailable.value) {
    emit('refresh')
  }
})
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ side: 'top', align: 'start', sideOffset: 8 }"
    :ui="{ content: 'rounded-xl bg-elevated shadow-xl ring ring-default' }"
  >
    <UTooltip :text="capabilityUnavailable ? capability.message : 'Choose realtime voice'">
      <span
        class="inline-flex shrink-0 rounded-full"
        :tabindex="capabilityUnavailable ? 0 : undefined"
        :aria-label="capabilityUnavailable ? capability.message : undefined"
        :aria-disabled="capabilityUnavailable ? 'true' : undefined"
      >
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="sm"
          icon="i-lucide-audio-waveform"
          :loading="catalog.status === 'loading'"
          :disabled="capabilityUnavailable"
          :aria-expanded="open"
          aria-label="Choose realtime voice"
          class="h-11 max-w-44 shrink-0 rounded-full border border-default/70 px-3 md:h-8"
          :ui="{ leadingIcon: 'size-4' }"
        >
          <span class="truncate text-xs">{{ triggerLabel }}</span>
          <UIcon
            name="i-lucide-chevron-down"
            class="size-3.5 shrink-0 text-muted"
          />
        </UButton>
      </span>
    </UTooltip>

    <template #content>
      <div class="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3">
        <div>
          <h2 class="text-sm font-semibold text-highlighted">
            Realtime voice
          </h2>
          <p class="mt-0.5 text-xs text-muted">
            Voice changes apply to the next conversation.
          </p>
        </div>

        <div
          v-if="capabilityUnavailable"
          class="rounded-lg bg-error/10 px-3 py-2 text-xs text-error"
          role="alert"
        >
          {{ capability.message }}
        </div>

        <div
          v-else-if="catalog.status === 'loading' || catalog.status === 'idle'"
          class="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs text-toned"
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
          class="flex items-center justify-between gap-3 rounded-lg bg-error/10 px-3 py-2 text-xs text-error"
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

        <div
          v-else
          class="max-h-72 space-y-1 overflow-y-auto"
        >
          <fieldset class="space-y-1">
            <legend class="sr-only">
              Realtime voice override
            </legend>
            <div class="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/50">
              <label
                class="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm"
              >
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
                <span class="truncate">Use Codex setting</span>
              </label>
            </div>

            <div
              v-for="voice in catalog.voices"
              :key="voice"
              class="flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-muted/50"
            >
              <label
                class="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm"
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
                <span class="truncate">{{ voice }}</span>
                <span
                  v-if="catalog.protocolDefault === voice"
                  class="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-toned"
                >
                  Protocol default
                </span>
                <span
                  v-if="savedVoice === voice"
                  class="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary"
                >
                  Saved
                </span>
              </label>
            </div>

            <p
              v-if="catalog.voices.length === 0"
              class="px-2 py-3 text-xs text-muted"
            >
              Codex did not advertise any V3-compatible voices.
            </p>
          </fieldset>

          <div
            v-if="catalog.voices.length > 0"
            class="mt-2 border-t border-default/70 pt-2"
          >
            <p class="px-2 pb-1 text-xs font-medium text-toned">
              Voice previews
            </p>
            <div class="flex flex-wrap gap-1">
              <UTooltip
                v-for="voice in catalog.voices"
                :key="`preview-${voice}`"
                :text="previewUnavailableReason || (isPreviewing(voice) ? `Stop ${voice} preview` : `Preview ${voice}`)"
              >
                <UButton
                  type="button"
                  color="neutral"
                  :variant="isPreviewing(voice) ? 'soft' : 'ghost'"
                  size="sm"
                  :icon="isPreviewing(voice) ? 'i-lucide-square' : 'i-lucide-play'"
                  :loading="activeVoice === voice && previewStatus === 'loading'"
                  :disabled="Boolean(previewUnavailableReason)"
                  :aria-label="isPreviewing(voice) ? `Stop preview for ${voice}` : `Preview voice ${voice}`"
                  class="min-h-9 rounded-full px-2.5"
                  :ui="{ leadingIcon: 'size-4' }"
                  @click="handlePreview(voice)"
                >
                  {{ voice }}
                </UButton>
              </UTooltip>
            </div>
          </div>
        </div>

        <p
          v-if="staleSavedVoice"
          class="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning"
        >
          Saved voice “{{ savedVoice }}” is not advertised by this Codex server. Codex settings will be used.
        </p>

        <p
          v-if="previewUnavailableReason"
          class="text-xs text-muted"
        >
          {{ previewUnavailableReason }}
        </p>

        <p
          v-if="previewStatusText"
          class="text-xs text-toned"
          :class="previewStatus === 'error' || previewStatus === 'blocked' ? 'text-error' : ''"
          aria-live="polite"
          aria-atomic="true"
        >
          {{ previewStatusText }}
        </p>
      </div>
    </template>
  </UPopover>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ServerPetAvatar from './ServerPetAvatar.vue'
import type {
  RealtimeActivity,
  RealtimeSessionState,
  RealtimeTranscriptSegment
} from '../composables/useRealtimeConversation'
import {
  isRealtimeVoiceCompanionActive,
  resolveCenteredRealtimeVoiceAvatarWidth,
  resolveRealtimeVoiceAvatarWidth,
  resolveRealtimeVoiceCompanionEntries
} from '../utils/realtime-voice-companion'
import {
  createTranscriptVisibilityState,
  expireTranscriptVisibility,
  reconcileTranscriptVisibility,
  type TranscriptVisibilityState
} from '~~/shared/realtime-transcript'
import type { ServerAvatarMetadata } from '~~/shared/server-avatar'

const props = withDefaults(defineProps<{
  avatar: ServerAvatarMetadata | null
  spriteUrl: string | null
  sessionState: RealtimeSessionState
  activity: RealtimeActivity
  generation: number
  transcripts: RealtimeTranscriptSegment[]
  bottomOffset: number
  presentation?: 'floating' | 'centered'
  showTranscripts?: boolean
}>(), {
  presentation: 'floating',
  showTranscripts: true
})

const emit = defineEmits<{
  stop: []
}>()

const bubbleOpen = ref(false)
const viewportWidth = ref(375)
const latestAnnouncement = ref('')
let closeTimer: ReturnType<typeof setTimeout> | null = null
let visibilityState: TranscriptVisibilityState = createTranscriptVisibilityState(props.generation)
let announcementGeneration = props.generation
const announcedFinalSegments = new Set<number>()

const active = computed(() => isRealtimeVoiceCompanionActive(props.sessionState))
const centered = computed(() => props.presentation === 'centered')
const avatarWidth = computed(() => centered.value
  ? resolveCenteredRealtimeVoiceAvatarWidth(viewportWidth.value)
  : resolveRealtimeVoiceAvatarWidth(viewportWidth.value)
)
const entries = computed(() => props.showTranscripts
  ? resolveRealtimeVoiceCompanionEntries({
      transcripts: props.transcripts,
      generation: props.generation
    })
  : []
)
const transcriptSignature = computed(() =>
  entries.value
    .map(entry => `${entry.id}:${entry.role}:${entry.final ? 1 : 0}:${entry.text}`)
    .join('\u0000')
)
const announcementSignature = computed(() =>
  (props.showTranscripts ? props.transcripts : [])
    .filter(segment =>
      segment.generation === props.generation
      && (segment.role === 'user' || segment.role === 'assistant')
    )
    .map(segment => `${segment.id}:${segment.role}:${segment.final ? 1 : 0}:${segment.text}`)
    .join('\u0000')
)
const rootStyle = computed(() => centered.value
  ? {}
  : { bottom: `${Math.max(12, props.bottomOffset)}px` }
)
const rootClass = computed(() => centered.value
  ? 'pointer-events-none fixed inset-0 z-20 flex items-center justify-center'
  : 'pointer-events-none fixed end-3 z-20 md:end-6'
)

const clearCloseTimer = () => {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

const closeBubble = () => {
  clearCloseTimer()
  visibilityState = createTranscriptVisibilityState(props.generation)
  bubbleOpen.value = false
}

const updateBubbleOpen = (open: boolean) => {
  if (!open) {
    bubbleOpen.value = false
  }
}

watch(
  [active, () => props.generation, transcriptSignature],
  ([isActive, generation]) => {
    clearCloseTimer()
    visibilityState = reconcileTranscriptVisibility(visibilityState, {
      active: isActive && props.showTranscripts,
      segments: props.showTranscripts ? props.transcripts : [],
      generation,
      roles: ['user', 'assistant'],
      nowMs: Date.now()
    })
    bubbleOpen.value = visibilityState.visible
    if (visibilityState.hideAtMs === null) {
      return
    }

    closeTimer = setTimeout(() => {
      visibilityState = expireTranscriptVisibility(visibilityState, Date.now())
      bubbleOpen.value = visibilityState.visible
      closeTimer = null
    }, Math.max(0, visibilityState.hideAtMs - Date.now()))
  },
  { immediate: true }
)

watch(
  [active, () => props.generation, announcementSignature],
  ([isActive, generation]) => {
    if (generation !== announcementGeneration) {
      announcementGeneration = generation
      announcedFinalSegments.clear()
      latestAnnouncement.value = ''
    }
    if (!isActive || !props.showTranscripts) {
      announcedFinalSegments.clear()
      latestAnnouncement.value = ''
      return
    }

    let newestFinal: RealtimeTranscriptSegment | null = null
    for (const segment of props.transcripts) {
      if (
        segment.generation !== generation
        || (segment.role !== 'user' && segment.role !== 'assistant')
        || !segment.final
        || !segment.text.trim()
        || announcedFinalSegments.has(segment.id)
      ) {
        continue
      }
      announcedFinalSegments.add(segment.id)
      newestFinal = segment
    }
    if (!newestFinal) {
      return
    }

    const speaker = newestFinal.role === 'user'
      ? 'You'
      : props.avatar?.displayName || 'Codex'
    latestAnnouncement.value = `${speaker}: ${newestFinal.text.trim()}`
  },
  { immediate: true }
)

const syncAvatarWidth = () => {
  viewportWidth.value = window.visualViewport?.width ?? window.innerWidth
}

onMounted(() => {
  syncAvatarWidth()
  window.addEventListener('resize', syncAvatarWidth)
  window.visualViewport?.addEventListener('resize', syncAvatarWidth)
})

onBeforeUnmount(() => {
  closeBubble()
  window.removeEventListener('resize', syncAvatarWidth)
  window.visualViewport?.removeEventListener('resize', syncAvatarWidth)
})
</script>

<template>
  <div
    v-if="active"
    data-testid="realtime-voice-companion"
    :data-presentation="presentation"
    :data-activity="activity"
    :class="rootClass"
    :style="rootStyle"
  >
    <button
      v-if="centered"
      type="button"
      data-testid="realtime-voice-centered-stop"
      aria-label="Stop voice companion"
      class="pointer-events-auto rounded-full outline-none transition focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-4 focus-visible:ring-offset-default"
      @click="emit('stop')"
    >
      <span class="block drop-shadow-2xl">
        <ServerPetAvatar
          :avatar="avatar"
          :sprite-url="spriteUrl"
          animation="idle"
          :width="avatarWidth"
        />
      </span>
    </button>

    <UPopover
      v-else
      :open="bubbleOpen && entries.length > 0"
      :content="{ side: 'top', align: 'end', sideOffset: 10 }"
      :ui="{
        content: 'rounded-xl bg-elevated/95 shadow-xl ring ring-default backdrop-blur'
      }"
      @update:open="updateBubbleOpen"
    >
      <span class="block drop-shadow-lg">
        <ServerPetAvatar
          :avatar="avatar"
          :sprite-url="spriteUrl"
          animation="idle"
          :width="avatarWidth"
        />
      </span>

      <template #content>
        <div
          data-testid="realtime-voice-bubble"
          class="pointer-events-none w-[min(20rem,calc(100vw-2rem))] space-y-3 p-3"
        >
          <div
            v-for="entry in entries"
            :key="`${entry.generation}:${entry.id}`"
            :data-testid="`realtime-transcript-${entry.role}`"
            class="space-y-0.5"
          >
            <p
              class="text-[11px] font-medium"
              :class="entry.role === 'user' ? 'text-dimmed' : 'text-toned'"
            >
              {{ entry.role === 'user' ? 'You' : (avatar?.displayName || 'Codex') }}
            </p>
            <p
              class="text-sm leading-snug"
              :class="entry.role === 'user' ? 'text-muted' : 'text-default'"
            >
              {{ entry.text }}
            </p>
          </div>
        </div>
      </template>
    </UPopover>

    <p
      aria-live="polite"
      aria-atomic="true"
      class="sr-only"
    >
      {{ latestAnnouncement }}
    </p>
  </div>
</template>

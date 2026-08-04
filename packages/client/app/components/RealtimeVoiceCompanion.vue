<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ServerPetAvatar from './ServerPetAvatar.vue'
import RealtimeVoiceTranscriptList from './RealtimeVoiceTranscriptList.vue'
import type {
  RealtimeActivity,
  RealtimeAvatarCue,
  RealtimeAvatarCueKind,
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
  avatarCue?: RealtimeAvatarCue | null
  generation: number
  transcripts: RealtimeTranscriptSegment[]
  bottomOffset: number
  presentation?: 'floating' | 'centered'
}>(), {
  avatarCue: null,
  presentation: 'floating'
})

const emit = defineEmits<{
  stop: []
}>()

const bubbleOpen = ref(false)
const viewportWidth = ref(375)
const latestAnnouncement = ref('')
const avatarAnimation = ref('idle')
const avatarAnimationKey = ref(0)
let closeTimer: ReturnType<typeof setTimeout> | null = null
let avatarCueTimer: ReturnType<typeof setTimeout> | null = null
let activeAvatarCue: RealtimeAvatarCueKind | null = null
const avatarCueQueue: RealtimeAvatarCueKind[] = []
let visibilityState: TranscriptVisibilityState = createTranscriptVisibilityState(props.generation)
let announcementGeneration = props.generation
const announcedFinalSegments = new Set<number>()

const active = computed(() => isRealtimeVoiceCompanionActive(props.sessionState))
const centered = computed(() => props.presentation === 'centered')
const avatarWidth = computed(() => centered.value
  ? resolveCenteredRealtimeVoiceAvatarWidth(viewportWidth.value)
  : resolveRealtimeVoiceAvatarWidth(viewportWidth.value)
)
const entries = computed(() => resolveRealtimeVoiceCompanionEntries({
  transcripts: props.transcripts,
  generation: props.generation
}))
const transcriptSignature = computed(() =>
  entries.value
    .map(entry => `${entry.id}:${entry.role}:${entry.final ? 1 : 0}:${entry.text}`)
    .join('\u0000')
)
const announcementSignature = computed(() =>
  props.transcripts
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
// 65% keeps the backdrop faintly visible while every caption text token stays
// above the WCAG AA 4.5:1 threshold against the composited surface.
const transcriptSurfaceClass = 'rounded-xl bg-elevated/65 shadow-xl ring ring-default backdrop-blur-md'
const CAPTION_LEAVE_MS = 160
const captionMounted = ref(false)
const captionLeaving = ref(false)
let captionLeaveTimer: ReturnType<typeof setTimeout> | null = null
const captionRequested = computed(() => bubbleOpen.value && entries.value.length > 0)
const captionClass = computed(() => captionLeaving.value
  ? 'realtime-voice-caption-leave'
  : 'realtime-voice-caption-enter'
)

const clearCaptionLeaveTimer = () => {
  if (captionLeaveTimer) {
    clearTimeout(captionLeaveTimer)
    captionLeaveTimer = null
  }
}

watch(captionRequested, (requested) => {
  clearCaptionLeaveTimer()
  if (requested) {
    // An incoming caption always wins over an in-flight dismissal so new
    // transcript text is never delayed by the leave animation.
    captionLeaving.value = false
    captionMounted.value = true
    return
  }

  if (!captionMounted.value) {
    return
  }

  if (!active.value || entries.value.length === 0) {
    // A session that stopped, a generation reset, and cleared transcripts all
    // remove the caption immediately. The companion root itself disappears in
    // those cases, so there is nothing to animate out.
    captionLeaving.value = false
    captionMounted.value = false
    return
  }

  captionLeaving.value = true
  captionLeaveTimer = setTimeout(() => {
    captionLeaveTimer = null
    captionLeaving.value = false
    captionMounted.value = false
  }, CAPTION_LEAVE_MS)
}, { immediate: true, flush: 'sync' })

const AVATAR_CUE_ANIMATIONS: Record<RealtimeAvatarCueKind, string[]> = {
  'turn-start': ['waving', 'wave'],
  'tool-start': ['running', 'running-right', 'move_right'],
  'tool-failed': ['failed', 'sad'],
  'turn-complete': ['jumping', 'bounce'],
  'turn-failed': ['failed', 'sad']
}

const resolveAvatarCueAnimation = (cue: RealtimeAvatarCueKind) =>
  AVATAR_CUE_ANIMATIONS[cue].find(name => props.avatar?.animations[name]) ?? null

const resolveAvatarCueDuration = (animationName: string) => {
  const animation = props.avatar?.animations[animationName]
  if (!animation?.frames.length) {
    return 0
  }

  const cueFrameCount = animation.loopStart !== null && animation.loopStart > 0
    ? animation.loopStart
    : animation.frames.length
  const durationMs = animation.frames
    .slice(0, cueFrameCount)
    .reduce((total, frame) => total + Math.max(16, frame.durationMs), 0)
  return Math.min(6_000, Math.max(400, durationMs))
}

const clearAvatarCueTimer = () => {
  if (avatarCueTimer) {
    clearTimeout(avatarCueTimer)
    avatarCueTimer = null
  }
}

const playNextAvatarCue = () => {
  if (activeAvatarCue || !active.value || !props.avatar) {
    return
  }

  while (avatarCueQueue.length > 0) {
    const cue = avatarCueQueue.shift()
    if (!cue) {
      break
    }
    const animationName = resolveAvatarCueAnimation(cue)
    if (!animationName) {
      continue
    }

    activeAvatarCue = cue
    avatarAnimation.value = animationName
    avatarAnimationKey.value += 1
    avatarCueTimer = setTimeout(() => {
      avatarCueTimer = null
      activeAvatarCue = null
      avatarAnimation.value = 'idle'
      avatarAnimationKey.value += 1
      playNextAvatarCue()
    }, resolveAvatarCueDuration(animationName))
    return
  }

  avatarAnimation.value = 'idle'
}

const resetAvatarCues = () => {
  clearAvatarCueTimer()
  activeAvatarCue = null
  avatarCueQueue.length = 0
  avatarAnimation.value = 'idle'
  avatarAnimationKey.value += 1
}

const enqueueAvatarCue = (cue: RealtimeAvatarCueKind) => {
  const urgent = cue === 'tool-failed' || cue === 'turn-failed'
  if (urgent) {
    clearAvatarCueTimer()
    activeAvatarCue = null
    avatarCueQueue.length = 0
    avatarAnimation.value = 'idle'
    avatarAnimationKey.value += 1
  } else if (activeAvatarCue === cue || avatarCueQueue.includes(cue)) {
    return
  }

  avatarCueQueue.push(cue)
  if (avatarCueQueue.length > 4) {
    avatarCueQueue.shift()
  }
  playNextAvatarCue()
}

const clearCloseTimer = () => {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

const closeBubble = () => {
  clearCloseTimer()
  clearCaptionLeaveTimer()
  captionLeaving.value = false
  captionMounted.value = false
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
      active: isActive,
      segments: props.transcripts,
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

watch(() => props.avatarCue?.sequence, () => {
  if (active.value && props.avatarCue) {
    enqueueAvatarCue(props.avatarCue.kind)
  }
})

watch(() => props.avatar?.revision, () => {
  playNextAvatarCue()
})

watch([active, () => props.generation], resetAvatarCues)

watch(
  [active, () => props.generation, announcementSignature],
  ([isActive, generation]) => {
    if (generation !== announcementGeneration) {
      announcementGeneration = generation
      announcedFinalSegments.clear()
      latestAnnouncement.value = ''
    }
    if (!isActive) {
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
  resetAvatarCues()
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
    <div
      v-if="centered"
      data-testid="realtime-voice-subtitle-region"
      class="absolute inset-x-0 top-0 flex h-[38%] items-end justify-center px-4 pb-4"
    >
      <div
        v-if="captionMounted"
        data-testid="realtime-voice-subtitles"
        class="max-h-full w-[min(40rem,calc(100vw-2rem))] space-y-3 overflow-hidden p-4 text-center"
        :class="[transcriptSurfaceClass, captionClass]"
      >
        <RealtimeVoiceTranscriptList
          :entries="entries"
          :speaker-name="avatar?.displayName ?? null"
          size="subtitle"
        />
      </div>
    </div>

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
          :animation="avatarAnimation"
          :playback-key="avatarAnimationKey"
          :width="avatarWidth"
        />
      </span>
    </button>

    <UPopover
      v-else
      :open="captionMounted"
      :content="{ side: 'top', align: 'end', sideOffset: 10 }"
      :ui="{
        content: transcriptSurfaceClass
      }"
      @update:open="updateBubbleOpen"
    >
      <span class="block drop-shadow-lg">
        <ServerPetAvatar
          :avatar="avatar"
          :sprite-url="spriteUrl"
          :animation="avatarAnimation"
          :playback-key="avatarAnimationKey"
          :width="avatarWidth"
        />
      </span>

      <template #content>
        <div
          data-testid="realtime-voice-bubble"
          class="pointer-events-none w-[min(20rem,calc(100vw-2rem))] space-y-3 p-3"
          :class="captionClass"
        >
          <RealtimeVoiceTranscriptList
            :entries="entries"
            :speaker-name="avatar?.displayName ?? null"
          />
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

<style scoped>
/* The caption surface animates only when it first appears. Streaming transcript
   updates mutate text inside a persistent element, so they never restart this
   animation and never move the surrounding layout. */
.realtime-voice-caption-enter {
  animation: realtime-voice-caption-enter 220ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transform-origin: center bottom;
  will-change: opacity, transform;
}

.realtime-voice-caption-leave {
  animation: realtime-voice-caption-leave 160ms cubic-bezier(0.4, 0, 1, 1) both;
  transform-origin: center bottom;
  pointer-events: none;
  will-change: opacity, transform;
}

@keyframes realtime-voice-caption-enter {
  0% {
    opacity: 0;
    transform: translate3d(0, 6px, 0) scale(0.985);
  }

  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }
}

@keyframes realtime-voice-caption-leave {
  0% {
    opacity: 1;
    transform: translate3d(0, 0, 0) scale(1);
  }

  100% {
    opacity: 0;
    transform: translate3d(0, 4px, 0) scale(0.99);
  }
}

@media (prefers-reduced-motion: reduce) {
  .realtime-voice-caption-enter {
    animation: realtime-voice-caption-fade 120ms ease-out both;
    will-change: opacity;
  }

  .realtime-voice-caption-leave {
    animation: realtime-voice-caption-fade-out 100ms ease-in both;
    will-change: opacity;
  }
}

@keyframes realtime-voice-caption-fade {
  0% {
    opacity: 0;
  }

  100% {
    opacity: 1;
  }
}

@keyframes realtime-voice-caption-fade-out {
  0% {
    opacity: 1;
  }

  100% {
    opacity: 0;
  }
}
</style>

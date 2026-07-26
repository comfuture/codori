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
  resolveRealtimeVoiceAvatarWidth,
  resolveRealtimeVoiceCompanionEntries
} from '../utils/realtime-voice-companion'
import type { ServerAvatarMetadata } from '~~/shared/server-avatar'

const props = defineProps<{
  avatar: ServerAvatarMetadata | null
  spriteUrl: string | null
  sessionState: RealtimeSessionState
  activity: RealtimeActivity
  generation: number
  transcripts: RealtimeTranscriptSegment[]
  bottomOffset: number
}>()

const bubbleOpen = ref(false)
const avatarWidth = ref(64)
const latestAnnouncement = ref('')
let closeTimer: ReturnType<typeof setTimeout> | null = null
let closeGeneration = 0
let announcementGeneration = props.generation
const announcedFinalSegments = new Set<number>()

const active = computed(() => isRealtimeVoiceCompanionActive(props.sessionState))
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
const rootStyle = computed(() => ({
  bottom: `${Math.max(12, props.bottomOffset)}px`
}))

const clearCloseTimer = () => {
  if (closeTimer) {
    clearTimeout(closeTimer)
    closeTimer = null
  }
}

const closeBubble = () => {
  clearCloseTimer()
  closeGeneration += 1
  bubbleOpen.value = false
}

const updateBubbleOpen = (open: boolean) => {
  if (!open) {
    bubbleOpen.value = false
  }
}

watch(
  [active, () => props.generation, transcriptSignature],
  ([isActive, generation, signature]) => {
    clearCloseTimer()
    const timerGeneration = ++closeGeneration
    if (!isActive || !signature) {
      bubbleOpen.value = false
      return
    }

    bubbleOpen.value = true
    closeTimer = setTimeout(() => {
      if (
        timerGeneration === closeGeneration
        && props.generation === generation
        && active.value
      ) {
        bubbleOpen.value = false
        closeTimer = null
      }
    }, 5000)
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
  avatarWidth.value = resolveRealtimeVoiceAvatarWidth(
    window.visualViewport?.width ?? window.innerWidth
  )
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
    :data-activity="activity"
    class="pointer-events-none fixed end-3 z-20 md:end-6"
    :style="rootStyle"
  >
    <UPopover
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

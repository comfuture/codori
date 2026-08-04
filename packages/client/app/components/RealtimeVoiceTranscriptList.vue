<script setup lang="ts">
import type { RealtimeVoiceCompanionEntry } from '../utils/realtime-voice-companion'

const props = withDefaults(defineProps<{
  entries: RealtimeVoiceCompanionEntry[]
  speakerName?: string | null
  size?: 'compact' | 'subtitle'
}>(), {
  speakerName: null,
  size: 'compact'
})

const resolveSpeaker = (role: RealtimeVoiceCompanionEntry['role']) =>
  role === 'user' ? 'You' : (props.speakerName || 'Codex')
</script>

<template>
  <div
    v-for="entry in props.entries"
    :key="`${entry.generation}:${entry.id}`"
    :data-testid="`realtime-transcript-${entry.role}`"
    class="space-y-0.5"
  >
    <p
      class="font-medium"
      :class="[
        props.size === 'subtitle' ? 'text-xs' : 'text-[11px]',
        'text-default'
      ]"
    >
      {{ resolveSpeaker(entry.role) }}
    </p>
    <p
      class="leading-snug"
      :class="[
        props.size === 'subtitle' ? 'text-base md:text-lg' : 'text-sm',
        entry.role === 'user' ? 'text-default' : 'text-highlighted'
      ]"
    >
      {{ entry.text }}
    </p>
  </div>
</template>

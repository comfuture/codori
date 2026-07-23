<script setup lang="ts">
import { REALTIME_DELEGATION_PART, type RealtimeDelegationData } from '~~/shared/codex-chat'

defineProps<{
  part?: {
    type: typeof REALTIME_DELEGATION_PART
    data: RealtimeDelegationData
  } | null
}>()
</script>

<template>
  <div
    v-if="part?.type === REALTIME_DELEGATION_PART"
    data-realtime-delegation
    class="max-w-3xl rounded-xl border border-muted bg-elevated/25 px-3 py-2 text-xs text-muted"
  >
    <div class="flex items-center gap-1.5 font-medium">
      <UIcon
        name="i-lucide-audio-lines"
        class="size-3.5 shrink-0"
      />
      <span>Voice delegation</span>
    </div>

    <p class="mt-1.5 whitespace-pre-wrap leading-5 text-toned">
      {{ part.data.input }}
    </p>

    <details
      v-if="part.data.transcriptDelta"
      class="mt-2"
    >
      <summary class="cursor-pointer select-none font-medium hover:text-toned">
        Conversation context
      </summary>
      <pre class="mt-1 max-h-40 overflow-auto whitespace-pre-wrap border-l border-muted pl-2 font-sans leading-5 text-muted">{{ part.data.transcriptDelta }}</pre>
    </details>
  </div>
</template>

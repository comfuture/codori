<script setup lang="ts">
import { computed } from 'vue'
import { REALTIME_DELEGATION_PART, type RealtimeDelegationData } from '~~/shared/codex-chat'

const props = defineProps<{
  part?: {
    type: typeof REALTIME_DELEGATION_PART
    data: RealtimeDelegationData
  } | null
}>()

const isPartial = computed(() => props.part?.data.parse === 'partial')
const inputText = computed(() => props.part?.data.input?.trim() ?? '')
const statusLabel = computed(() => isPartial.value
  ? (inputText.value ? 'Voice delegation, still arriving' : 'Voice delegation, no request text yet')
  : 'Voice delegation')
</script>

<template>
  <div
    v-if="part?.type === REALTIME_DELEGATION_PART"
    data-realtime-delegation
    :data-realtime-delegation-parse="part.data.parse ?? 'complete'"
    class="max-w-3xl rounded-xl border border-muted bg-elevated/25 px-3 py-2 text-xs text-muted"
  >
    <div class="flex flex-wrap items-center gap-1.5 font-medium">
      <UIcon
        name="i-lucide-audio-lines"
        class="size-3.5 shrink-0"
      />
      <span>{{ statusLabel }}</span>
      <UTooltip text="This request arrived through a realtime voice conversation.">
        <UBadge
          color="neutral"
          variant="subtle"
          size="sm"
          label="Voice"
        />
      </UTooltip>
    </div>

    <p
      v-if="inputText"
      class="mt-1.5 whitespace-pre-wrap leading-5 text-toned"
    >
      {{ part.data.input }}
    </p>
    <p
      v-else
      class="mt-1.5 leading-5 italic"
    >
      No request text was recognized in this delegation.
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

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { DEFAULT_REALTIME_VOICE_PROMPT } from '../composables/useRealtimeVoicePreference'

const props = defineProps<{
  configuredPrompt: string | null
  promptOverride: string | null
  loading: boolean
  error: string | null
}>()

const emit = defineEmits<{
  save: [prompt: string]
  clear: []
  refresh: []
}>()

const basePrompt = computed(() =>
  props.configuredPrompt ?? DEFAULT_REALTIME_VOICE_PROMPT
)
const effectivePrompt = computed(() =>
  props.promptOverride ?? basePrompt.value
)
const sourceLabel = computed(() =>
  props.promptOverride !== null
    ? 'Browser override'
    : props.configuredPrompt !== null
      ? 'config.toml'
      : 'Codori default'
)
const draft = ref(effectivePrompt.value)
const hasChanges = computed(() =>
  draft.value.trim() !== effectivePrompt.value
)

watch(effectivePrompt, (prompt) => {
  draft.value = prompt
})

const save = () => {
  const prompt = draft.value.trim()
  if (prompt) {
    emit('save', prompt)
  }
}

const clear = () => {
  draft.value = basePrompt.value
  emit('clear')
}
</script>

<template>
  <div class="border-b border-default py-6">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-sm font-medium text-highlighted">
            Voice instructions
          </h3>
          <UBadge
            color="neutral"
            variant="soft"
            size="sm"
          >
            {{ sourceLabel }}
          </UBadge>
        </div>
        <p class="mt-1 text-sm leading-6 text-muted">
          Codori uses the configured backend prompt first. A browser override applies only to voice sessions started from this browser.
        </p>
      </div>

      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-refresh-cw"
        label="Reload config"
        :loading="loading"
        @click="emit('refresh')"
      />
    </div>

    <div
      v-if="loading"
      class="mt-5 flex items-center gap-2 text-sm text-toned"
      role="status"
    >
      <UIcon
        name="i-lucide-loader-circle"
        class="size-4 animate-spin"
      />
      Reading config.toml
    </div>

    <p
      v-if="error"
      class="mt-5 border-s-2 border-warning ps-4 text-sm leading-6 text-warning"
      role="alert"
    >
      {{ error }} The Codori default remains available as a fallback.
    </p>

    <div class="mt-5">
      <label
        for="realtime-voice-prompt"
        class="text-sm font-medium text-highlighted"
      >
        Instruction used for new sessions
      </label>
      <p class="mt-1 text-xs leading-5 text-muted">
        Saving creates a local override. Clearing it returns to config.toml, or to the Codori default when the config has no value.
      </p>
      <UTextarea
        id="realtime-voice-prompt"
        v-model="draft"
        :rows="4"
        autoresize
        class="mt-3 w-full"
      />
    </div>

    <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-muted">
        Browser overrides are stored only in localStorage.
      </p>
      <div class="flex gap-2">
        <UButton
          v-if="promptOverride !== null"
          type="button"
          color="neutral"
          variant="ghost"
          size="sm"
          label="Use config.toml"
          @click="clear"
        />
        <UButton
          type="button"
          color="primary"
          size="sm"
          icon="i-lucide-save"
          label="Save browser override"
          :disabled="!draft.trim() || !hasChanges"
          @click="save"
        />
      </div>
    </div>
  </div>
</template>

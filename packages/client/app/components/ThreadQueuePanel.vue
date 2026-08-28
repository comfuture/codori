<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { QueuedSubmission } from '~~/shared/generated/codex-app-server/v2/QueuedSubmission'
import {
  isTextOnlyThreadQueueSubmission,
  moveThreadQueueSubmission,
  summarizeThreadQueueSubmission,
  threadQueueSubmissionText
} from '~~/shared/thread-queue'

const props = defineProps<{
  submissions: QueuedSubmission[]
  paused: boolean
  loading: boolean
  mutating: boolean
  error: string | null
}>()

const emit = defineEmits<{
  update: [submissionId: string, text: string]
  remove: [submissionId: string]
  reorder: [submissionIds: string[]]
  start: [submissionId?: string]
}>()

const editingId = ref<string | null>(null)
const editText = ref('')
const queueBusy = computed(() => props.loading || props.mutating)

watch(() => props.submissions, (submissions) => {
  if (editingId.value && !submissions.some(submission => submission.id === editingId.value)) {
    editingId.value = null
    editText.value = ''
  }
})

const beginEdit = (submission: QueuedSubmission) => {
  if (!isTextOnlyThreadQueueSubmission(submission)) {
    return
  }
  editingId.value = submission.id
  editText.value = threadQueueSubmissionText(submission)
}

const cancelEdit = () => {
  editingId.value = null
  editText.value = ''
}

const saveEdit = () => {
  const submissionId = editingId.value
  const text = editText.value.trim()
  if (!submissionId || !text) {
    return
  }
  emit('update', submissionId, text)
  cancelEdit()
}

const move = (submissionId: string, delta: -1 | 1) => {
  const reordered = moveThreadQueueSubmission(props.submissions, submissionId, delta)
  if (reordered === props.submissions) {
    return
  }
  emit('reorder', reordered.map(submission => submission.id))
}
</script>

<template>
  <section
    aria-label="Queued prompts"
    class="mb-2"
  >
    <header class="flex min-h-7 items-center gap-2 px-1 text-xs text-muted">
      <span class="font-medium text-toned">After current turn</span>
      <span>{{ submissions.length }}</span>
      <span
        v-if="paused"
        class="text-warning"
      >
        Paused
      </span>
      <div class="ml-auto flex items-center">
        <button
          v-if="paused && submissions.length"
          type="button"
          :disabled="queueBusy"
          class="flex size-6 items-center justify-center rounded-md text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Start next queued prompt"
          title="Start next queued prompt"
          @click="emit('start')"
        >
          <UIcon
            name="i-lucide-play"
            class="size-3.5"
          />
        </button>
      </div>
    </header>

    <p
      v-if="error"
      role="alert"
      class="px-1 pb-1 text-xs text-error"
    >
      {{ error }}
    </p>

    <ol
      v-if="submissions.length"
      class="space-y-0.5"
    >
      <li
        v-for="(submission, index) in submissions"
        :key="submission.id"
        class="group flex min-h-8 items-center gap-1.5 rounded-lg px-1.5 py-1 transition hover:bg-elevated/45"
      >
        <span class="w-4 shrink-0 text-right text-[11px] tabular-nums text-muted">
          {{ index + 1 }}
        </span>

        <form
          v-if="editingId === submission.id"
          class="flex min-w-0 flex-1 items-center gap-0"
          @submit.prevent="saveEdit"
        >
          <input
            v-model="editText"
            aria-label="Edit queued prompt"
            class="min-w-0 flex-1 rounded-lg bg-elevated/70 px-2 py-1 text-sm text-highlighted outline-none ring-0"
            @keydown.esc.prevent="cancelEdit"
          >
          <div class="ml-auto flex shrink-0 items-center gap-0">
            <button
              type="submit"
              :disabled="queueBusy || !editText.trim()"
              class="flex size-6 items-center justify-center rounded-md text-primary transition hover:bg-primary/10 disabled:opacity-30"
              aria-label="Save queued prompt"
              title="Save"
            >
              <UIcon
                name="i-lucide-check"
                class="size-3.5"
              />
            </button>
            <button
              type="button"
              class="flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-elevated"
              aria-label="Cancel queued prompt edit"
              title="Cancel"
              @click="cancelEdit"
            >
              <UIcon
                name="i-lucide-x"
                class="size-3.5"
              />
            </button>
          </div>
        </form>

        <template v-else>
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            <UIcon
              v-if="!isTextOnlyThreadQueueSubmission(submission)"
              name="i-lucide-paperclip"
              class="size-3 shrink-0 text-warning"
            />
            <p
              class="min-w-0 flex-1 truncate text-sm text-highlighted"
              :title="summarizeThreadQueueSubmission(submission)"
            >
              {{ summarizeThreadQueueSubmission(submission) }}
            </p>
          </div>

          <div
            data-slot="trailing"
            class="ml-auto flex shrink-0 items-center gap-0 opacity-70 transition group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <button
              type="button"
              :disabled="queueBusy || index === 0"
              class="flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-elevated disabled:opacity-20"
              :aria-label="`Move queued prompt ${index + 1} up`"
              title="Move up"
              @click="move(submission.id, -1)"
            >
              <UIcon
                name="i-lucide-arrow-up"
                class="size-3.5"
              />
            </button>
            <button
              type="button"
              :disabled="queueBusy || index === submissions.length - 1"
              class="flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-elevated disabled:opacity-20"
              :aria-label="`Move queued prompt ${index + 1} down`"
              title="Move down"
              @click="move(submission.id, 1)"
            >
              <UIcon
                name="i-lucide-arrow-down"
                class="size-3.5"
              />
            </button>
            <button
              type="button"
              :disabled="queueBusy || !isTextOnlyThreadQueueSubmission(submission)"
              class="flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-elevated disabled:opacity-20"
              :aria-label="`Edit queued prompt ${index + 1}`"
              :title="isTextOnlyThreadQueueSubmission(submission) ? 'Edit' : 'Structured queued inputs cannot be edited in Codori'"
              @click="beginEdit(submission)"
            >
              <UIcon
                name="i-lucide-pencil"
                class="size-3.5"
              />
            </button>
            <button
              v-if="paused"
              type="button"
              :disabled="queueBusy"
              class="flex size-6 items-center justify-center rounded-md text-primary transition hover:bg-primary/10 disabled:opacity-20"
              :aria-label="`Start queued prompt ${index + 1}`"
              title="Run this prompt"
              @click="emit('start', submission.id)"
            >
              <UIcon
                name="i-lucide-play"
                class="size-3.5"
              />
            </button>
            <button
              type="button"
              :disabled="queueBusy"
              class="flex size-6 items-center justify-center rounded-md text-muted transition hover:bg-error/10 hover:text-error disabled:opacity-20"
              :aria-label="`Delete queued prompt ${index + 1}`"
              title="Delete"
              @click="emit('remove', submission.id)"
            >
              <UIcon
                name="i-lucide-trash-2"
                class="size-3.5"
              />
            </button>
          </div>
        </template>
      </li>
    </ol>
  </section>
</template>

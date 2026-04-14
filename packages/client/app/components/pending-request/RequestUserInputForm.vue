<script setup lang="ts">
import { computed, reactive } from 'vue'
import type { PendingRequestUserInput, PendingRequestUserInputQuestion } from '../../../shared/pending-user-request'

const props = defineProps<{
  request: PendingRequestUserInput
}>()

const emit = defineEmits<{
  submit: [answers: Record<string, string[]>]
}>()

const selectedAnswers = reactive<Record<string, string[]>>({})
const customAnswers = reactive<Record<string, string>>({})

const questionAllowsCustomAnswer = (question: PendingRequestUserInputQuestion) =>
  question.isOther || question.options.length === 0

const resolveSelectedAnswers = (questionId: string) => selectedAnswers[questionId] ?? []

const toggleOption = (questionId: string, label: string) => {
  const current = resolveSelectedAnswers(questionId)
  selectedAnswers[questionId] = current.includes(label)
    ? current.filter(option => option !== label)
    : [...current, label]
}

const resolveAnswerList = (question: PendingRequestUserInputQuestion) => {
  const selected = resolveSelectedAnswers(question.id)
  const custom = customAnswers[question.id]?.trim()

  return custom ? [...selected, custom] : selected
}

const canSubmit = computed(() =>
  props.request.questions.every(question => resolveAnswerList(question).length > 0)
)

const submit = () => {
  if (!canSubmit.value) {
    return
  }

  emit('submit', Object.fromEntries(
    props.request.questions.map(question => [question.id, resolveAnswerList(question)])
  ))
}
</script>

<template>
  <form
    class="space-y-4"
    @submit.prevent="submit"
  >
    <section
      v-for="question in request.questions"
      :key="question.id"
      class="rounded-3xl border border-default bg-elevated/30 p-4"
    >
      <div class="space-y-2">
        <p
          v-if="question.header"
          class="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary"
        >
          {{ question.header }}
        </p>
        <h3 class="text-sm font-semibold text-highlighted">
          {{ question.question }}
        </h3>
        <p
          v-if="question.isSecret"
          class="text-xs text-muted"
        >
          The response will be treated as sensitive input.
        </p>
      </div>

      <div
        v-if="question.options.length"
        class="mt-4 flex flex-wrap gap-2"
      >
        <button
          v-for="option in question.options"
          :key="option.label"
          type="button"
          class="rounded-full border px-3 py-2 text-left text-sm transition"
          :class="resolveSelectedAnswers(question.id).includes(option.label)
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-default bg-default text-default hover:border-primary/40 hover:text-highlighted'"
          @click="toggleOption(question.id, option.label)"
        >
          <span class="font-medium">{{ option.label }}</span>
          <span
            v-if="option.description"
            class="block text-xs text-muted"
          >
            {{ option.description }}
          </span>
        </button>
      </div>

      <div
        v-if="questionAllowsCustomAnswer(question)"
        class="mt-4"
      >
        <label
          :for="`request-user-input-${question.id}`"
          class="mb-2 block text-xs font-medium uppercase tracking-[0.16em] text-muted"
        >
          {{ question.options.length ? 'Custom answer' : 'Answer' }}
        </label>

        <textarea
          v-if="!question.isSecret && question.options.length === 0"
          :id="`request-user-input-${question.id}`"
          v-model="customAnswers[question.id]"
          rows="4"
          class="min-h-28 w-full rounded-2xl border border-default bg-default px-3 py-2 text-sm text-default outline-none transition focus:border-primary/50"
          :placeholder="question.options.length ? 'Add anything else Codex should know' : 'Type your answer'"
        />

        <input
          v-else
          :id="`request-user-input-${question.id}`"
          v-model="customAnswers[question.id]"
          class="w-full rounded-2xl border border-default bg-default px-3 py-2 text-sm text-default outline-none transition focus:border-primary/50"
          :type="question.isSecret ? 'password' : 'text'"
          :placeholder="question.options.length ? 'Add anything else Codex should know' : 'Type your answer'"
        >
      </div>
    </section>

    <div class="flex items-center justify-end">
      <button
        type="submit"
        class="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-inverted transition disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="!canSubmit"
      >
        Send response
      </button>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { PendingRequestUserInput, PendingRequestUserInputQuestion } from '../../../shared/pending-user-request'

const props = defineProps<{
  request: PendingRequestUserInput
  submitting?: boolean
}>()

const emit = defineEmits<{
  submit: [answers: Record<string, string[]>]
}>()

const selectedAnswers = reactive<Record<string, string[]>>({})
const customAnswers = reactive<Record<string, string>>({})
const activeQuestionIndex = ref(0)

const resetState = () => {
  activeQuestionIndex.value = 0

  for (const questionId of Object.keys(selectedAnswers)) {
    delete selectedAnswers[questionId]
  }

  for (const questionId of Object.keys(customAnswers)) {
    delete customAnswers[questionId]
  }
}

watch(() => props.request.requestId, resetState, { immediate: true })

const questionAllowsCustomAnswer = (question: PendingRequestUserInputQuestion) =>
  question.isOther || question.options.length === 0

const resolveSelectedAnswers = (questionId: string) => selectedAnswers[questionId] ?? []

const resolveAnswerList = (question: PendingRequestUserInputQuestion) => {
  const selected = resolveSelectedAnswers(question.id)
  const custom = customAnswers[question.id]?.trim()

  return custom ? [...selected, custom] : selected
}

const totalQuestions = computed(() => props.request.questions.length)
const currentQuestion = computed(() => props.request.questions[activeQuestionIndex.value] ?? null)
const isLastQuestion = computed(() => activeQuestionIndex.value === totalQuestions.value - 1)

const selectOption = (question: PendingRequestUserInputQuestion, optionLabel: string) => {
  if (props.submitting) {
    return
  }

  selectedAnswers[question.id] = [optionLabel]
  delete customAnswers[question.id]
  if (isLastQuestion.value) {
    submit()
    return
  }

  activeQuestionIndex.value += 1
}

const canAdvanceWithCustom = computed(() => {
  if (!currentQuestion.value || !questionAllowsCustomAnswer(currentQuestion.value)) {
    return false
  }

  return Boolean(customAnswers[currentQuestion.value.id]?.trim())
})

const canSubmit = computed(() =>
  props.request.questions.length > 0
  && props.request.questions.every(question => resolveAnswerList(question).length > 0)
)

const goBack = () => {
  if (props.submitting) {
    return
  }

  activeQuestionIndex.value = Math.max(activeQuestionIndex.value - 1, 0)
}

const continueWithCustomAnswer = () => {
  if (props.submitting) {
    return
  }

  if (!currentQuestion.value) {
    return
  }

  const customAnswer = customAnswers[currentQuestion.value.id]?.trim()
  if (!customAnswer) {
    return
  }

  selectedAnswers[currentQuestion.value.id] = []
  customAnswers[currentQuestion.value.id] = customAnswer
  if (isLastQuestion.value) {
    submit()
    return
  }

  activeQuestionIndex.value += 1
}

const submit = () => {
  if (props.submitting || !canSubmit.value) {
    return
  }

  emit('submit', Object.fromEntries(
    props.request.questions.map(question => [question.id, resolveAnswerList(question)])
  ))
}
</script>

<template>
  <form
    class="space-y-2"
    @submit.prevent="continueWithCustomAnswer()"
  >
    <div
      v-if="currentQuestion"
      class="space-y-2"
    >
      <div class="flex items-center justify-between gap-3">
        <p class="text-xs text-muted">
          {{ activeQuestionIndex + 1 }} / {{ totalQuestions }}
        </p>

        <UButton
          v-if="activeQuestionIndex > 0"
          type="button"
          color="neutral"
          variant="ghost"
          size="xs"
          class="rounded-lg"
          :disabled="submitting"
          @click="goBack"
        >
          Back
        </UButton>
      </div>

      <div class="space-y-2">
        <h3 class="text-base font-semibold text-highlighted">
          {{ currentQuestion.question }}
        </h3>

        <p
          v-if="currentQuestion.isSecret"
          class="text-xs text-muted"
        >
          The response will be treated as sensitive input.
        </p>

        <div
          v-if="currentQuestion.options.length"
          class="space-y-1"
        >
          <button
            v-for="option in currentQuestion.options"
            :key="`${currentQuestion.id}:${option.label}`"
            type="button"
            class="flex min-h-10 w-full items-start gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors"
            :class="resolveSelectedAnswers(currentQuestion.id).includes(option.label)
              ? 'bg-elevated text-highlighted'
              : 'bg-default text-toned hover:bg-elevated/70'"
            :disabled="submitting"
            @click="selectOption(currentQuestion, option.label)"
          >
            <div class="min-w-0 flex-1 text-left">
              <div class="font-medium text-highlighted">
                {{ option.label }}
              </div>
              <div
                v-if="option.description"
                class="text-xs text-muted"
              >
                {{ option.description }}
              </div>
            </div>
            <UIcon
              v-if="resolveSelectedAnswers(currentQuestion.id).includes(option.label)"
              name="i-lucide-check"
              class="mt-0.5 size-4 shrink-0 text-primary"
            />
          </button>
        </div>

        <UFormField
          v-if="questionAllowsCustomAnswer(currentQuestion)"
          size="sm"
          :ui="{
            root: '',
            container: 'mt-0'
          }"
        >
          <UInput
            :id="`request-user-input-${currentQuestion.id}`"
            v-model="customAnswers[currentQuestion.id]"
            :type="currentQuestion.isSecret ? 'password' : 'text'"
            :placeholder="currentQuestion.options.length ? 'Type a custom response' : 'Type your response'"
            color="neutral"
            variant="subtle"
            size="sm"
            class="w-full"
            :disabled="submitting"
            :ui="{
              base: 'min-h-10 rounded-lg px-3 text-sm'
            }"
          />
        </UFormField>

        <div
          v-if="questionAllowsCustomAnswer(currentQuestion)"
          class="flex justify-end"
        >
          <UButton
            type="submit"
            color="primary"
            size="sm"
            class="rounded-lg"
            :disabled="submitting || !canAdvanceWithCustom"
          >
            {{ submitting ? 'Sending...' : isLastQuestion ? 'Send response' : 'Continue' }}
          </UButton>
        </div>
      </div>
    </div>
  </form>
</template>

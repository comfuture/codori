<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { NavigationMenuItem } from '@nuxt/ui'
import type { PendingRequestUserInput, PendingRequestUserInputQuestion } from '../../../shared/pending-user-request'

const props = defineProps<{
  request: PendingRequestUserInput
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

const totalQuestions = computed(() => props.request.questions.length)
const currentQuestion = computed(() => props.request.questions[activeQuestionIndex.value] ?? null)
const isLastQuestion = computed(() => activeQuestionIndex.value === totalQuestions.value - 1)

const questionOptionItems = (question: PendingRequestUserInputQuestion): NavigationMenuItem[] =>
  question.options.map(option => ({
    label: option.label,
    description: option.description ?? undefined,
    active: resolveSelectedAnswers(question.id).includes(option.label),
    onSelect: (event: Event) => {
      event.preventDefault()
      selectedAnswers[question.id] = [option.label]
      delete customAnswers[question.id]
      if (isLastQuestion.value) {
        submit()
        return
      }

      activeQuestionIndex.value += 1
    }
  }))

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
  activeQuestionIndex.value = Math.max(activeQuestionIndex.value - 1, 0)
}

const continueWithCustomAnswer = () => {
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

        <UNavigationMenu
          v-if="currentQuestion.options.length"
          :items="questionOptionItems(currentQuestion)"
          orientation="vertical"
          variant="pill"
          color="neutral"
          :highlight="false"
          :popover="false"
          class="w-full"
          :ui="{
            root: 'w-full',
            list: 'gap-1',
            item: 'w-full',
            link: 'w-full min-h-10 items-start rounded-lg px-3 py-2 text-left text-sm',
            linkLabel: 'min-w-0 flex-1',
            linkTrailing: 'ms-2 shrink-0',
            linkLeadingIcon: 'hidden'
          }"
        >
          <template #item-label="{ item }">
            <div class="min-w-0 text-left">
              <div class="font-medium text-highlighted">
                {{ item.label }}
              </div>
              <div
                v-if="item.description"
                class="text-xs text-muted"
              >
                {{ item.description }}
              </div>
            </div>
          </template>

          <template #item-trailing="{ item }">
            <UIcon
              v-if="item.active"
              name="i-lucide-check"
              class="size-4 text-primary"
            />
          </template>
        </UNavigationMenu>

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
            :disabled="!canAdvanceWithCustom"
          >
            {{ isLastQuestion ? 'Send response' : 'Continue' }}
          </UButton>
        </div>
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AsyncUserInputQuestion } from '../../../shared/generated/codex-app-server/v2/AsyncUserInputQuestion'
import type { AsyncUserAnswer } from '../../composables/useAsyncUserQuestions'

const props = defineProps<{
  questions: AsyncUserInputQuestion[]
  questionIndex?: number
  disabled?: boolean
}>()

const emit = defineEmits<{
  reply: [answer: AsyncUserAnswer]
}>()

const customAnswer = ref('')
const currentIndex = computed(() => props.questionIndex ?? 0)
const question = computed(() => props.questions[currentIndex.value])
watch(() => [props.questions, currentIndex.value], () => { customAnswer.value = '' })

const sendAnswer = (answer: string) => {
  if (props.disabled || !question.value || !answer.trim()) return
  emit('reply', {
    text: `${question.value.title}\n${answer.trim()}`,
    questionIndex: currentIndex.value
  })
}
</script>

<template>
  <form
    v-if="question"
    class="space-y-3"
    @submit.prevent="sendAnswer(customAnswer)"
  >
    <p
      v-if="questions.length > 1"
      class="text-xs text-muted"
    >
      {{ currentIndex + 1 }} / {{ questions.length }}
    </p>
    <h3 class="whitespace-pre-wrap text-base font-semibold text-highlighted">
      {{ question.title }}
    </h3>
    <div
      v-if="question.options?.length"
      class="space-y-1"
    >
      <button
        v-for="(option, index) in question.options"
        :key="index"
        type="button"
        class="min-h-10 w-full cursor-pointer rounded-lg bg-default px-3 py-2 text-left text-sm text-highlighted transition-colors hover:bg-elevated focus-visible:bg-elevated disabled:cursor-not-allowed disabled:opacity-50"
        :disabled="disabled"
        @click="sendAnswer(option)"
      >
        {{ option }}
      </button>
    </div>
    <label class="block space-y-1 text-xs text-muted">
      <span>{{ question.options?.length ? 'Or write your own answer' : 'Your answer' }}</span>
      <textarea
        v-model="customAnswer"
        rows="2"
        class="w-full resize-y rounded-lg border border-default bg-default px-3 py-2 text-sm text-highlighted outline-none focus:border-primary"
        :disabled="disabled"
      />
    </label>
    <div class="flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-muted">
        Codex can keep working while you answer.
      </p>
      <UButton
        type="submit"
        size="sm"
        :disabled="disabled || !customAnswer.trim()"
      >
        {{ disabled ? 'Sending...' : 'Send response' }}
      </UButton>
    </div>
  </form>
</template>

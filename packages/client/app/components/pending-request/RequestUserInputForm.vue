<script setup lang="ts">
import { computed, reactive } from 'vue'
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

const questionOptionItems = (question: PendingRequestUserInputQuestion): NavigationMenuItem[] =>
  question.options.map(option => ({
    label: option.label,
    description: option.description ?? undefined,
    active: resolveSelectedAnswers(question.id).includes(option.label),
    onSelect: (event: Event) => {
      event.preventDefault()
      toggleOption(question.id, option.label)
    }
  }))

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
    class="space-y-3"
    @submit.prevent="submit"
  >
    <div
      v-for="question in request.questions"
      :key="question.id"
      class="rounded-lg border border-default/70 bg-elevated/20 p-3"
    >
      <UFormField
        :label="question.question"
        :description="question.header ?? undefined"
        :help="question.isSecret ? 'The response will be treated as sensitive input.' : undefined"
        size="sm"
        :ui="{
          root: 'space-y-2',
          container: 'mt-2',
          label: 'text-sm font-semibold text-highlighted',
          description: 'text-[11px] font-semibold uppercase tracking-[0.16em] text-primary',
          help: 'mt-2 text-xs text-muted'
        }"
        >
        <UNavigationMenu
          v-if="question.options.length"
          :items="questionOptionItems(question)"
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
            link: 'w-full rounded-lg px-3 py-2 text-sm',
            linkLabel: 'min-w-0 flex-1',
            linkTrailing: 'ms-2 shrink-0',
            linkLeadingIcon: 'hidden'
          }"
        >
          <template #item-label="{ item }">
            <div class="min-w-0">
              <div class="truncate font-medium text-highlighted">
                {{ item.label }}
              </div>
              <div
                v-if="item.description"
                class="truncate text-xs text-muted"
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
          v-if="questionAllowsCustomAnswer(question)"
          :label="question.options.length ? 'Custom answer' : 'Answer'"
          size="sm"
          :ui="{
            root: question.options.length ? 'pt-2' : '',
            container: 'mt-1.5',
            label: 'text-xs font-medium uppercase tracking-[0.14em] text-muted'
          }"
        >
          <UInput
            :id="`request-user-input-${question.id}`"
            v-model="customAnswers[question.id]"
            :type="question.isSecret ? 'password' : 'text'"
            :placeholder="question.options.length ? 'Add anything else Codex should know' : 'Type your answer'"
            color="neutral"
            variant="subtle"
            size="sm"
            class="w-full"
            :ui="{
              base: 'rounded-lg'
            }"
          />
        </UFormField>
      </UFormField>
    </div>

    <div
      class="flex items-center justify-end pt-1"
    >
      <UButton
        type="submit"
        color="primary"
        size="sm"
        class="rounded-lg"
        :disabled="!canSubmit"
      >
        Send response
      </UButton>
    </div>
  </form>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import BottomDrawerShell from './BottomDrawerShell.vue'
import {
  formatGoalElapsedSeconds,
  goalStatusLabel
} from '~~/shared/thread-goal'
import type { ThreadGoal } from '~~/shared/generated/codex-app-server/v2/ThreadGoal'

const props = withDefaults(defineProps<{
  open?: boolean
  mode?: 'summary' | 'edit'
  goal?: ThreadGoal | null
  loading?: boolean
  submitting?: boolean
  error?: string | null
  draftObjective?: string
}>(), {
  open: false,
  mode: 'summary',
  goal: null,
  loading: false,
  submitting: false,
  error: null,
  draftObjective: ''
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  'update:draftObjective': [objective: string]
  edit: []
  saveObjective: [objective: string]
  pause: []
  resume: []
  clear: []
}>()

const objectiveTextarea = ref<{ $el?: HTMLElement } | HTMLTextAreaElement | null>(null)

const title = computed(() =>
  props.mode === 'edit' ? 'Edit goal' : 'Thread goal'
)

const description = computed(() =>
  props.mode === 'edit'
    ? 'Update the persistent objective Codex should continue toward.'
    : 'Inspect and control the persistent objective for this thread.'
)

const statusLabel = computed(() =>
  props.goal ? goalStatusLabel(props.goal.status) : 'No goal'
)

const statusColor = computed(() => {
  switch (props.goal?.status) {
    case 'active':
      return 'primary'
    case 'paused':
      return 'warning'
    case 'budgetLimited':
      return 'error'
    case 'complete':
      return 'success'
    default:
      return 'neutral'
  }
})

const tokenBudgetLabel = computed(() => {
  if (!props.goal) {
    return null
  }

  const used = props.goal.tokensUsed.toLocaleString()
  if (props.goal.tokenBudget == null) {
    return `${used} used`
  }

  return `${used} / ${props.goal.tokenBudget.toLocaleString()}`
})

const elapsedLabel = computed(() =>
  props.goal ? formatGoalElapsedSeconds(props.goal.timeUsedSeconds) : null
)

const trimmedDraftObjective = computed(() => props.draftObjective.trim())

const submitEdit = () => {
  if (!trimmedDraftObjective.value) {
    return
  }

  emit('saveObjective', trimmedDraftObjective.value)
}

watch(() => [props.open, props.mode] as const, async ([open, mode]) => {
  if (!open || mode !== 'edit') {
    return
  }

  await nextTick()
  requestAnimationFrame(() => {
    const element = objectiveTextarea.value instanceof HTMLTextAreaElement
      ? objectiveTextarea.value
      : objectiveTextarea.value?.$el?.querySelector?.('textarea')
    element?.focus()
  })
})
</script>

<template>
  <BottomDrawerShell
    :open="open"
    :title="title"
    :description="description"
    body-class="px-4 pb-4 pt-2 md:px-5"
    @update:open="emit('update:open', $event)"
  >
    <div class="space-y-3">
      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        :title="error"
      />

      <div
        v-if="loading"
        class="rounded-lg border border-default bg-elevated/30 px-4 py-5 text-sm text-muted"
      >
        Loading thread goal...
      </div>

      <form
        v-else-if="mode === 'edit'"
        class="space-y-3"
        @submit.prevent="submitEdit"
      >
        <UTextarea
          ref="objectiveTextarea"
          :model-value="draftObjective"
          :disabled="submitting"
          :rows="4"
          autoresize
          placeholder="Describe the long-running goal for this thread"
          class="w-full"
          @update:model-value="emit('update:draftObjective', String($event ?? ''))"
        />

        <div class="flex flex-wrap justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="submitting"
            @click="emit('update:open', false)"
          >
            Cancel
          </UButton>
          <UButton
            type="submit"
            color="primary"
            icon="i-lucide-save"
            :loading="submitting"
            :disabled="!trimmedDraftObjective"
          >
            Save goal
          </UButton>
        </div>
      </form>

      <div
        v-else-if="goal"
        class="space-y-3"
      >
        <div class="rounded-lg border border-default bg-elevated/30 px-4 py-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <UBadge
              :color="statusColor"
              variant="soft"
              class="rounded-full"
            >
              {{ statusLabel }}
            </UBadge>
            <div class="flex items-center gap-2 text-xs text-muted">
              <span v-if="elapsedLabel">{{ elapsedLabel }}</span>
              <span v-if="tokenBudgetLabel">{{ tokenBudgetLabel }} tokens</span>
            </div>
          </div>

          <p class="mt-3 whitespace-pre-wrap text-sm leading-6 text-highlighted">
            {{ goal.objective }}
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="outline"
            icon="i-lucide-pencil"
            :disabled="submitting"
            @click="emit('edit')"
          >
            Edit
          </UButton>
          <UButton
            v-if="goal.status === 'paused'"
            type="button"
            color="primary"
            variant="soft"
            icon="i-lucide-play"
            :loading="submitting"
            @click="emit('resume')"
          >
            Resume
          </UButton>
          <UButton
            v-else-if="goal.status === 'active'"
            type="button"
            color="warning"
            variant="soft"
            icon="i-lucide-pause"
            :loading="submitting"
            @click="emit('pause')"
          >
            Pause
          </UButton>
          <UButton
            type="button"
            color="error"
            variant="ghost"
            icon="i-lucide-trash-2"
            :loading="submitting"
            @click="emit('clear')"
          >
            Clear
          </UButton>
        </div>
      </div>

      <div
        v-else
        class="space-y-3 rounded-lg border border-dashed border-default px-4 py-5 text-sm text-muted"
      >
        <p>No goal is currently set for this thread.</p>
        <p>Use <span class="font-mono text-highlighted">/goal &lt;objective&gt;</span> to start a persistent goal.</p>
      </div>
    </div>
  </BottomDrawerShell>
</template>

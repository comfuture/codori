<script setup lang="ts">
import { computed } from 'vue'
import {
  resolveTurnPlanStepMeta,
  type ThreadPlanState
} from '../../shared/turn-plan'

const props = defineProps<{
  plan: ThreadPlanState
}>()

const emit = defineEmits<{
  toggle: [open: boolean]
}>()

const completedCount = computed(() =>
  props.plan.plan.filter(step => step.status === 'completed').length
)

const inProgressCount = computed(() =>
  props.plan.plan.filter(step => step.status === 'inProgress').length
)

const pendingCount = computed(() =>
  props.plan.plan.filter(step => step.status === 'pending').length
)

const summaryText = computed(() => {
  const segments: string[] = []

  if (inProgressCount.value > 0) {
    segments.push(`${inProgressCount.value} active`)
  }

  if (completedCount.value > 0) {
    segments.push(`${completedCount.value} done`)
  }

  if (pendingCount.value > 0) {
    segments.push(`${pendingCount.value} pending`)
  }

  return segments.length > 0 ? segments.join(' · ') : 'No tasks'
})

const toggle = () => {
  emit('toggle', !props.plan.panelOpen)
}
</script>

<template>
  <section class="overflow-hidden rounded-lg border border-default bg-default">
    <button
      type="button"
      class="flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-elevated/40"
      :aria-expanded="plan.panelOpen"
      @click="toggle"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-highlighted">
            Task list
          </span>
          <span class="text-xs text-muted">
            {{ plan.plan.length }}
          </span>
        </div>
        <p
          v-if="plan.explanation"
          class="truncate text-xs leading-5 text-muted"
        >
          {{ plan.explanation }}
        </p>
      </div>

      <div class="flex shrink-0 items-center gap-2 text-xs text-muted">
        <span>{{ summaryText }}</span>
        <UIcon
          name="i-lucide-chevron-up"
          class="size-4 text-muted transition-transform"
          :class="plan.panelOpen ? '' : 'rotate-180'"
        />
      </div>
    </button>

    <div
      v-if="plan.panelOpen"
      class="border-t border-default px-3 py-2"
    >
      <ol class="max-h-[40vh] space-y-1.5 overflow-y-auto text-sm">
        <li
          v-for="(step, index) in plan.plan"
          :key="`${index}-${step.step}`"
          class="leading-5 text-highlighted"
        >
          <div class="flex items-start gap-2">
            <template v-if="resolveTurnPlanStepMeta(step.status).kind === 'icon'">
              <UIcon
                :name="resolveTurnPlanStepMeta(step.status).icon!"
                class="mt-1 size-3.5 shrink-0"
                :class="resolveTurnPlanStepMeta(step.status).markerClass"
              />
            </template>
            <span
              v-else
              class="mt-[0.45rem] size-2 shrink-0 rounded-full"
              :class="resolveTurnPlanStepMeta(step.status).markerClass"
            />

            <p
              class="min-w-0 flex-1"
              :class="step.status === 'completed'
                ? 'text-muted'
                : step.status === 'pending'
                  ? 'text-toned'
                  : 'text-highlighted'"
            >
              <span class="text-toned">{{ `${index + 1}. ` }}</span>
              <span>{{ step.step }}</span>
            </p>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>

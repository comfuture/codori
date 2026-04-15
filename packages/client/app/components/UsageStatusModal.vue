<script setup lang="ts">
import { computed } from 'vue'
import {
  formatRateLimitWindowDuration,
  type RateLimitBucket
} from '../../shared/account-rate-limits'

type UsageWindowRow = {
  id: string
  title: string
  usedPercent: number | null
  percentLabel: string
  durationLabel: string | null
  resetsAt: string | null
  resetLabel: string
  durationMins: number | null
}

const props = withDefaults(defineProps<{
  open?: boolean
  loading?: boolean
  error?: string | null
  buckets?: RateLimitBucket[]
}>(), {
  open: false,
  loading: false,
  error: null,
  buckets: () => []
})

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const resetFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

const formatPercentLabel = (value: number | null) =>
  value == null ? 'Usage unavailable' : `${Math.round(value)}% used`

const formatResetLabel = (value: string | null) =>
  value ? `Resets ${resetFormatter.format(new Date(value))}` : 'Reset unavailable'

const cards = computed(() =>
  props.buckets.map((bucket) => {
    const windows = [{
      id: `${bucket.limitId}-primary`,
      title: formatRateLimitWindowDuration(bucket.primary?.windowDurationMins ?? null) ?? 'Primary window',
      usedPercent: bucket.primary?.usedPercent ?? null,
      percentLabel: formatPercentLabel(bucket.primary?.usedPercent ?? null),
      durationLabel: formatRateLimitWindowDuration(bucket.primary?.windowDurationMins ?? null),
      resetsAt: bucket.primary?.resetsAt ?? null,
      resetLabel: formatResetLabel(bucket.primary?.resetsAt ?? null),
      durationMins: bucket.primary?.windowDurationMins ?? null
    }, {
      id: `${bucket.limitId}-secondary`,
      title: formatRateLimitWindowDuration(bucket.secondary?.windowDurationMins ?? null) ?? 'Secondary window',
      usedPercent: bucket.secondary?.usedPercent ?? null,
      percentLabel: formatPercentLabel(bucket.secondary?.usedPercent ?? null),
      durationLabel: formatRateLimitWindowDuration(bucket.secondary?.windowDurationMins ?? null),
      resetsAt: bucket.secondary?.resetsAt ?? null,
      resetLabel: formatResetLabel(bucket.secondary?.resetsAt ?? null),
      durationMins: bucket.secondary?.windowDurationMins ?? null
    }]
      .filter((window) =>
        window.usedPercent != null
        || window.resetsAt != null
        || window.durationMins != null
      )
      .sort((left, right) => (left.durationMins ?? Number.POSITIVE_INFINITY) - (right.durationMins ?? Number.POSITIVE_INFINITY))

    return {
      id: bucket.limitId,
      label: bucket.limitName ?? bucket.limitId,
      detail: bucket.limitName && bucket.limitName !== bucket.limitId ? bucket.limitId : null,
      windows
    }
  })
)
</script>

<template>
  <UModal
    :open="open"
    title="Usage status"
    description="Live Codex quota windows for the current account."
    :close="{
      color: 'neutral',
      variant: 'ghost',
      class: 'rounded-full'
    }"
    :ui="{
      overlay: 'bg-black/45 backdrop-blur-sm',
      content: 'w-[92vw] max-w-xl rounded-3xl border border-default bg-default shadow-2xl',
      header: 'px-4 pb-1 pt-4 sm:px-5',
      body: 'px-4 pb-4 pt-2 sm:px-5',
      title: 'text-sm font-semibold text-highlighted sm:text-base',
      description: 'text-sm leading-5 text-muted'
    }"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-3">
        <div
          v-if="loading"
          class="rounded-2xl border border-default bg-elevated/40 px-4 py-6 text-sm text-muted"
        >
          Loading current quota windows...
        </div>

        <UAlert
          v-else-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="error"
        />

        <div
          v-else-if="!cards.length"
          class="rounded-2xl border border-dashed border-default px-4 py-6 text-center text-sm text-muted"
        >
          No live quota windows were reported.
        </div>

        <div
          v-else
          class="space-y-3"
        >
          <section
            v-for="card in cards"
            :key="card.id"
            class="rounded-2xl border border-default bg-elevated/35 p-3 sm:p-4"
          >
            <div class="mb-3 flex items-start justify-between gap-3">
              <div class="min-w-0">
                <h3 class="truncate text-sm font-semibold text-highlighted">
                  {{ card.label }}
                </h3>
                <p
                  v-if="card.detail"
                  class="text-xs text-muted"
                >
                  {{ card.detail }}
                </p>
              </div>
              <div class="rounded-full border border-default px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em] text-muted">
                bucket
              </div>
            </div>

            <div class="space-y-2">
              <div
                v-for="window in card.windows"
                :key="window.id"
                class="rounded-xl border border-default/80 bg-default/75 p-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                    {{ window.title }}
                  </div>
                  <div class="text-sm font-semibold text-highlighted">
                    {{ window.percentLabel }}
                  </div>
                </div>

                <div class="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    class="h-full rounded-full bg-primary transition-[width]"
                    :style="{ width: `${window.usedPercent ?? 0}%` }"
                  />
                </div>

                <div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <time
                    v-if="window.resetsAt"
                    :datetime="window.resetsAt"
                  >
                    {{ window.resetLabel }}
                  </time>
                  <span v-else>
                    {{ window.resetLabel }}
                  </span>
                  <span v-if="window.durationLabel">
                    {{ window.durationLabel }}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>
  </UModal>
</template>

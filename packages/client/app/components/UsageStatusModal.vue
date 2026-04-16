<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useProjects } from '../composables/useProjects'
import { useRpc } from '../composables/useRpc'
import {
  normalizeAccountRateLimits,
  formatRateLimitWindowDuration,
  type RateLimitBucket
} from '../../shared/account-rate-limits'

const props = withDefaults(defineProps<{
  projectId: string
  open?: boolean
}>(), {
  open: false
})

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const { getClient } = useRpc()
const {
  loaded,
  refreshProjects,
  getProject,
  startProject
} = useProjects()
const loading = ref(false)
const error = ref<string | null>(null)
const buckets = ref<RateLimitBucket[]>([])
const selectedProject = computed(() => getProject(props.projectId))
let usageStatusLoadToken = 0
let releaseUsageStatusSubscription: (() => void) | null = null

const nextResetFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})

const toRemainingPercent = (usedPercent: number | null) =>
  usedPercent == null ? null : Math.max(0, 100 - usedPercent)

const formatProgressLabel = (usedPercent: number | null) => {
  const remainingPercent = toRemainingPercent(usedPercent)
  return remainingPercent == null ? 'Remaining quota unavailable' : `${Math.round(remainingPercent)}% remaining`
}

const formatNextResetLabel = (value: string | null) =>
  value ? `Next reset ${nextResetFormatter.format(new Date(value))}` : 'Next reset unavailable'

const cards = computed(() =>
  buckets.value.map((bucket) => {
    const windows = [{
      id: `${bucket.limitId}-primary`,
      title: formatRateLimitWindowDuration(bucket.primary?.windowDurationMins ?? null) ?? 'Primary window',
      remainingPercent: toRemainingPercent(bucket.primary?.usedPercent ?? null),
      progressLabel: formatProgressLabel(bucket.primary?.usedPercent ?? null),
      resetsAt: bucket.primary?.resetsAt ?? null,
      nextResetLabel: formatNextResetLabel(bucket.primary?.resetsAt ?? null),
      durationMins: bucket.primary?.windowDurationMins ?? null
    }, {
      id: `${bucket.limitId}-secondary`,
      title: formatRateLimitWindowDuration(bucket.secondary?.windowDurationMins ?? null) ?? 'Secondary window',
      remainingPercent: toRemainingPercent(bucket.secondary?.usedPercent ?? null),
      progressLabel: formatProgressLabel(bucket.secondary?.usedPercent ?? null),
      resetsAt: bucket.secondary?.resetsAt ?? null,
      nextResetLabel: formatNextResetLabel(bucket.secondary?.resetsAt ?? null),
      durationMins: bucket.secondary?.windowDurationMins ?? null
    }]
      .filter((window) =>
        window.remainingPercent != null
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

const resetUsageStatusState = () => {
  loading.value = false
  error.value = null
  buckets.value = []
}

const closeUsageStatus = () => {
  usageStatusLoadToken += 1
  releaseUsageStatusSubscription?.()
  releaseUsageStatusSubscription = null
  resetUsageStatusState()
}

const applyUsageStatusSnapshot = (value: unknown) => {
  buckets.value = normalizeAccountRateLimits(value)
  error.value = null
}

const ensureProjectRuntime = async () => {
  if (!loaded.value) {
    await refreshProjects()
  }

  if (selectedProject.value?.status === 'running') {
    return
  }

  await startProject(props.projectId)
}

const openUsageStatus = async () => {
  usageStatusLoadToken += 1
  const loadToken = usageStatusLoadToken
  loading.value = true
  error.value = null
  buckets.value = []

  const client = getClient(props.projectId)
  releaseUsageStatusSubscription?.()
  releaseUsageStatusSubscription = client.subscribe((notification) => {
    if (notification.method !== 'account/rateLimits/updated' || !props.open) {
      return
    }

    applyUsageStatusSnapshot(notification.params)
    loading.value = false
  })

  try {
    await ensureProjectRuntime()
    const response = await client.request('account/rateLimits/read')
    if (!props.open || loadToken !== usageStatusLoadToken) {
      return
    }

    applyUsageStatusSnapshot(response)
  } catch (caughtError) {
    if (!props.open || loadToken !== usageStatusLoadToken) {
      return
    }

    error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
  } finally {
    if (loadToken === usageStatusLoadToken) {
      loading.value = false
    }
  }
}

watch(() => [props.open, props.projectId] as const, ([open, projectId], previous) => {
  const [wasOpen, previousProjectId] = previous ?? [false, projectId]

  if (!open) {
    closeUsageStatus()
    return
  }

  if (!wasOpen || projectId !== previousProjectId) {
    void openUsageStatus()
  }
}, { immediate: true })

onBeforeUnmount(() => {
  closeUsageStatus()
})
</script>

<template>
  <UModal
    :open="open"
    title="Usage status"
    @update:open="emit('update:open', $event)"
  >
    <template #body>
      <div class="space-y-3">
        <div
          v-if="loading"
          class="rounded-lg border border-default bg-elevated/40 px-4 py-6 text-sm text-muted"
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
          class="rounded-lg border border-dashed border-default px-4 py-6 text-center text-sm text-muted"
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
            class="rounded-lg border border-default bg-elevated/35 p-3 sm:p-4"
          >
            <div class="mb-3 min-w-0">
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
            </div>

            <div class="space-y-2">
              <div
                v-for="window in card.windows"
                :key="window.id"
                class="rounded-lg border border-default/80 bg-default/75 p-3"
              >
                <div class="flex items-start justify-between gap-3">
                  <div class="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                    {{ window.title }}
                  </div>
                  <div class="text-sm font-semibold text-highlighted">
                    {{ window.progressLabel }}
                  </div>
                </div>

                <div class="mt-2 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    class="h-full rounded-full bg-primary transition-[width]"
                    :style="{ width: `${window.remainingPercent ?? 0}%` }"
                  />
                </div>

                <time
                  v-if="window.resetsAt"
                  class="mt-2 block text-xs text-muted"
                  :datetime="window.resetsAt"
                >
                  {{ window.nextResetLabel }}
                </time>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>
  </UModal>
</template>

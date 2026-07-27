<script setup lang="ts">
import { computed } from 'vue'
import { useRuntimeBackendStatus } from '../composables/useRuntimeBackendStatus'

const {
  status,
  loading,
  loadError,
  title,
  stateLabel,
  fallbackMessage,
  refresh
} = useRuntimeBackendStatus()

const backendLabel = computed(() =>
  status.value.backend === 'codex-daemon'
    ? 'First-party Codex'
    : status.value.backend === 'codori-managed'
      ? 'Codori-managed'
      : 'Not selected'
)

const transportLabel = computed(() =>
  status.value.transport === 'unix-socket'
    ? 'Unix socket'
    : status.value.transport === 'tcp-websocket'
      ? 'Local WebSocket'
      : 'None'
)

const stateColor = computed(() =>
  status.value.state === 'ready'
    ? 'success'
    : status.value.state === 'fallback'
      ? 'warning'
      : 'neutral'
)
</script>

<template>
  <div aria-live="polite">
    <div class="flex flex-col gap-4 border-b border-default py-6 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-sm font-medium text-highlighted">
            {{ title }}
          </h3>
          <UBadge
            :color="stateColor"
            variant="soft"
            size="sm"
          >
            {{ stateLabel }}
          </UBadge>
        </div>
        <p class="mt-2 text-sm leading-6 text-muted">
          Codori selects this backend automatically from the safe runtimes available to the server.
        </p>
      </div>

      <UButton
        type="button"
        color="neutral"
        variant="outline"
        size="sm"
        icon="i-lucide-refresh-cw"
        label="Refresh"
        :loading="loading"
        @click="refresh"
      />
    </div>

    <dl class="divide-y divide-default">
      <div class="grid gap-1 py-5 sm:grid-cols-[12rem_1fr] sm:gap-6">
        <dt class="text-sm font-medium text-highlighted">
          Backend
        </dt>
        <dd class="text-sm text-muted">
          {{ backendLabel }}
        </dd>
      </div>
      <div class="grid gap-1 py-5 sm:grid-cols-[12rem_1fr] sm:gap-6">
        <dt class="text-sm font-medium text-highlighted">
          Transport
        </dt>
        <dd class="text-sm text-muted">
          {{ transportLabel }}
        </dd>
      </div>
      <div
        v-if="status.version"
        class="grid gap-1 py-5 sm:grid-cols-[12rem_1fr] sm:gap-6"
      >
        <dt class="text-sm font-medium text-highlighted">
          Version
        </dt>
        <dd class="text-sm text-muted">
          {{ status.version }}
        </dd>
      </div>
    </dl>

    <p
      v-if="fallbackMessage"
      class="border-t border-default py-5 text-sm leading-6 text-warning"
    >
      {{ fallbackMessage }}
    </p>
    <div
      v-if="loadError"
      class="flex items-center justify-between gap-4 border-t border-default py-5"
      role="alert"
    >
      <p class="text-sm text-error">
        {{ loadError }}
      </p>
      <UButton
        type="button"
        color="error"
        variant="soft"
        size="xs"
        label="Retry"
        @click="refresh"
      />
    </div>

    <p class="border-t border-default py-6 text-sm leading-6 text-muted">
      Backend status is read-only. Codori never stops a shared daemon and does not expose internal socket paths or lifecycle controls here.
    </p>
  </div>
</template>

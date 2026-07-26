<script setup lang="ts">
import { useRuntimeConfig } from '#imports'
import { $fetch } from 'ofetch'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  RuntimeBackendFallbackReason,
  RuntimeBackendStatus,
  RuntimeBackendStatusResponse
} from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'

const idleStatus = (): RuntimeBackendStatus => ({
  backend: null,
  transport: null,
  state: 'idle',
  version: null,
  fallbackReason: null
})

const fallbackLabels: Record<RuntimeBackendFallbackReason, string> = {
  'unsupported-platform': 'The shared daemon is unsupported on this platform.',
  'daemon-unavailable': 'No ready Codex daemon was available.',
  'permission-denied': 'Codori could not access the daemon socket.',
  'daemon-unready': 'The daemon did not complete its app-server handshake.',
  'daemon-start-failed': 'Codori could not ensure the Codex daemon.',
  'invalid-daemon-response': 'The daemon command returned an incompatible response.',
  'incompatible-realtime': 'The daemon lacks the configured realtime voice capability.',
  'managed-runtime-stop-failed': 'The existing managed runtime could not be stopped safely.'
}

const status = ref<RuntimeBackendStatus>(idleStatus())
const loading = ref(false)
const loadError = ref<string | null>(null)
const configuredBase = String(useRuntimeConfig().public.serverBase ?? '')
const endpoint = shouldUseServerProxy(configuredBase)
  ? '/api/codori/runtime/backend'
  : resolveApiUrl('/runtime/backend', configuredBase)
let refreshTimer: number | null = null

const title = computed(() => {
  if (status.value.backend === 'codex-daemon') {
    return 'Codex daemon · Unix socket'
  }
  if (status.value.backend === 'codori-managed') {
    return 'Codori fallback · Local WebSocket'
  }
  return status.value.state === 'probing'
    ? 'Selecting app-server backend'
    : 'App-server starts on demand'
})

const stateLabel = computed(() => ({
  idle: 'Idle',
  probing: 'Probing',
  ready: 'Ready',
  fallback: 'Fallback'
})[status.value.state])

const icon = computed(() =>
  status.value.backend === 'codex-daemon'
    ? 'i-lucide-cable'
    : status.value.backend === 'codori-managed'
      ? 'i-lucide-server'
      : 'i-lucide-circle-dashed'
)

const color = computed(() =>
  status.value.state === 'ready'
    ? 'success'
    : status.value.state === 'fallback'
      ? 'warning'
      : 'neutral'
)

const fallbackMessage = computed(() =>
  status.value.fallbackReason
    ? fallbackLabels[status.value.fallbackReason]
    : null
)

const refresh = async () => {
  if (loading.value) {
    return
  }
  loading.value = true
  try {
    const response = await $fetch<RuntimeBackendStatusResponse>(endpoint)
    status.value = response.backend
    loadError.value = null
  } catch {
    loadError.value = 'Backend status is temporarily unavailable.'
  } finally {
    loading.value = false
  }
}

const refreshWhenVisible = () => {
  if (document.visibilityState === 'visible') {
    void refresh()
  }
}

onMounted(() => {
  void refresh()
  refreshTimer = window.setInterval(refreshWhenVisible, 15_000)
  window.addEventListener('focus', refreshWhenVisible)
  document.addEventListener('visibilitychange', refreshWhenVisible)
})

onBeforeUnmount(() => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer)
  }
  window.removeEventListener('focus', refreshWhenVisible)
  document.removeEventListener('visibilitychange', refreshWhenVisible)
})
</script>

<template>
  <UPopover>
    <UTooltip :text="title">
      <UButton
        :aria-label="`Runtime backend: ${title}`"
        :icon="icon"
        :color="color"
        variant="ghost"
        size="sm"
        :loading="loading"
      />
    </UTooltip>

    <template #content>
      <div
        class="w-72 space-y-3 p-4"
        aria-live="polite"
      >
        <div>
          <p class="text-sm font-medium">
            {{ title }}
          </p>
          <p class="mt-1 text-xs text-muted">
            {{ stateLabel }}
          </p>
        </div>

        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt class="text-muted">
            Backend
          </dt>
          <dd>
            {{ status.backend === 'codex-daemon' ? 'First-party Codex' : status.backend === 'codori-managed' ? 'Codori-managed' : 'Not selected' }}
          </dd>
          <dt class="text-muted">
            Transport
          </dt>
          <dd>
            {{ status.transport === 'unix-socket' ? 'Unix socket' : status.transport === 'tcp-websocket' ? 'Local WebSocket' : 'None' }}
          </dd>
          <template v-if="status.version">
            <dt class="text-muted">
              Version
            </dt>
            <dd>
              {{ status.version }}
            </dd>
          </template>
        </dl>

        <p
          v-if="fallbackMessage"
          class="text-xs text-warning"
        >
          {{ fallbackMessage }}
        </p>
        <p
          v-if="loadError"
          class="text-xs text-error"
        >
          {{ loadError }}
        </p>
        <p class="text-xs text-muted">
          Codori selects the backend automatically. Shared daemons are never stopped by Codori.
        </p>
      </div>
    </template>
  </UPopover>
</template>

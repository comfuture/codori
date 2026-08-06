import { useRuntimeConfig } from '#imports'
import { $fetch } from 'ofetch'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type {
  RuntimeBackendFallbackReason,
  RuntimeBackendStatus,
  RuntimeBackendStatusResponse
} from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'

const REFRESH_INTERVAL_MS = 15_000

export const RUNTIME_BACKEND_FALLBACK_LABELS: Record<RuntimeBackendFallbackReason, string> = {
  'unsupported-platform': 'The shared daemon is unsupported on this platform.',
  'daemon-unavailable': 'No ready Codex daemon was available.',
  'permission-denied': 'Codori could not access the daemon socket.',
  'daemon-unready': 'The daemon did not complete its app-server handshake.',
  'daemon-start-failed': 'Codori could not ensure the Codex daemon.',
  'invalid-daemon-response': 'The daemon command returned an incompatible response.',
  'incompatible-realtime': 'The daemon lacks the configured realtime voice capability.',
  'managed-runtime-stop-failed': 'The existing managed runtime could not be stopped safely.'
}

export const idleRuntimeBackendStatus = (): RuntimeBackendStatus => ({
  backend: null,
  transport: null,
  state: 'idle',
  version: null,
  fallbackReason: null,
  codexExecutable: null
})

export const resolveRuntimeBackendStatusEndpoint = (configuredBase: string) =>
  shouldUseServerProxy(configuredBase)
    ? '/api/codori/runtime/backend'
    : resolveApiUrl('/runtime/backend', configuredBase)

export const useRuntimeBackendStatus = () => {
  const status = ref<RuntimeBackendStatus>(idleRuntimeBackendStatus())
  const loading = ref(false)
  const loadError = ref<string | null>(null)
  const configuredBase = String(useRuntimeConfig().public.serverBase ?? '')
  const endpoint = resolveRuntimeBackendStatusEndpoint(configuredBase)
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

  const fallbackMessage = computed(() =>
    status.value.fallbackReason
      ? RUNTIME_BACKEND_FALLBACK_LABELS[status.value.fallbackReason]
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
    refreshTimer = window.setInterval(refreshWhenVisible, REFRESH_INTERVAL_MS)
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

  return {
    status,
    loading,
    loadError,
    title,
    stateLabel,
    fallbackMessage,
    refresh
  }
}

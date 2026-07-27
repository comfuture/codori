<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useSystemNotifications } from '../composables/useSystemNotifications'

const {
  supported,
  enabled,
  permission,
  refreshPermission,
  enable,
  disable
} = useSystemNotifications()
const updating = ref(false)

const stateLabel = computed(() => {
  if (!supported.value) {
    return 'Unavailable'
  }
  if (permission.value === 'denied') {
    return 'Blocked'
  }
  if (enabled.value) {
    return 'Enabled'
  }
  if (permission.value === 'granted') {
    return 'Off · Permission granted'
  }
  return 'Off · Permission not requested'
})

const stateDescription = computed(() => {
  if (!supported.value) {
    return 'This browser does not support system notifications.'
  }
  if (permission.value === 'denied') {
    return 'Notifications are blocked in browser settings. Change the site permission there to enable them.'
  }
  if (enabled.value) {
    return 'Codori may show one system notification when work finishes while this tab is in the background.'
  }
  if (permission.value === 'granted') {
    return 'Browser permission remains granted. Turn this on whenever you want background notifications again.'
  }
  return 'Turning this on asks for browser permission. Codori never requests permission when this page loads.'
})

const updateEnabled = async (nextEnabled: boolean) => {
  if (updating.value) {
    return
  }
  updating.value = true
  try {
    if (nextEnabled) {
      await enable()
    } else {
      disable()
    }
  } finally {
    updating.value = false
  }
}

const handleFocus = () => refreshPermission()

onMounted(() => {
  refreshPermission()
  window.addEventListener('focus', handleFocus)
})

onBeforeUnmount(() => {
  window.removeEventListener('focus', handleFocus)
})
</script>

<template>
  <div class="divide-y divide-default">
    <div class="flex flex-col gap-5 py-6 sm:flex-row sm:items-start sm:justify-between">
      <div class="max-w-xl">
        <div class="flex flex-wrap items-center gap-2">
          <h3 class="text-sm font-medium text-highlighted">
            Background completion alerts
          </h3>
          <UBadge
            :color="enabled ? 'success' : permission === 'denied' ? 'error' : 'neutral'"
            variant="soft"
            size="sm"
          >
            {{ stateLabel }}
          </UBadge>
        </div>
        <p
          id="notification-setting-description"
          class="mt-2 text-sm leading-6 text-muted"
        >
          {{ stateDescription }}
        </p>
      </div>

      <USwitch
        :model-value="enabled"
        :loading="updating"
        :disabled="!supported || permission === 'denied'"
        aria-label="System notifications"
        aria-describedby="notification-setting-description"
        @update:model-value="updateEnabled"
      />
    </div>

    <div class="py-6">
      <h3 class="text-sm font-medium text-highlighted">
        Delivery policy
      </h3>
      <p class="mt-2 text-sm leading-6 text-muted">
        A visible active tab keeps using Codori toasts for other threads. System notifications are reserved for completed work while the tab is in the background.
      </p>
    </div>
  </div>
</template>

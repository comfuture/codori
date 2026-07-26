<script setup lang="ts">
import { computed } from 'vue'
import { useSystemNotifications } from '../composables/useSystemNotifications'

defineProps<{
  collapsed?: boolean
}>()

const { supported, enabled, permission, enable, disable } = useSystemNotifications()
const tooltip = computed(() => {
  if (!supported.value) {
    return 'System notifications are unavailable in this browser.'
  }
  if (permission.value === 'denied') {
    return 'System notifications are blocked in browser settings.'
  }
  return enabled.value
    ? 'Turn off system notifications'
    : 'Notify me when Codori is in the background'
})

const toggle = async () => {
  if (enabled.value) {
    disable()
    return
  }
  await enable()
}
</script>

<template>
  <UTooltip :text="tooltip">
    <UButton
      color="neutral"
      variant="ghost"
      size="sm"
      :icon="enabled ? 'i-lucide-bell-ring' : 'i-lucide-bell'"
      :label="collapsed ? undefined : (enabled ? 'Notifications on' : 'Notifications off')"
      :aria-label="enabled ? 'Disable system notifications' : 'Enable system notifications'"
      :disabled="!supported || permission === 'denied'"
      @click="toggle"
    />
  </UTooltip>
</template>

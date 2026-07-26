import { computed, ref } from 'vue'

const STORAGE_KEY = 'codori:system-notifications'
const enabled = ref(false)
const hydrated = ref(false)

const hydrate = () => {
  if (hydrated.value || !import.meta.client) {
    return
  }
  hydrated.value = true
  try {
    enabled.value = localStorage.getItem(STORAGE_KEY) === 'enabled'
      && 'Notification' in window
      && Notification.permission === 'granted'
  } catch {
    enabled.value = false
  }
}

export const useSystemNotifications = () => {
  hydrate()
  const supported = computed(() => import.meta.client && 'Notification' in window)
  const permission = computed(() =>
    supported.value ? Notification.permission : 'default'
  )

  const enable = async () => {
    if (!supported.value) {
      return false
    }
    try {
      const nextPermission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission()
      enabled.value = nextPermission === 'granted'
      localStorage.setItem(STORAGE_KEY, enabled.value ? 'enabled' : 'disabled')
      return enabled.value
    } catch {
      enabled.value = false
      return false
    }
  }

  const disable = () => {
    enabled.value = false
    if (import.meta.client) {
      try {
        localStorage.setItem(STORAGE_KEY, 'disabled')
      } catch {
        // Notification opt-in is best-effort when storage is unavailable.
      }
    }
  }

  return {
    supported,
    enabled,
    permission,
    enable,
    disable
  }
}

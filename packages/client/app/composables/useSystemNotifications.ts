import { onMounted, ref } from 'vue'

export const SYSTEM_NOTIFICATIONS_STORAGE_KEY = 'codori:system-notifications'

type NotificationStorage = Pick<Storage, 'getItem' | 'setItem'>

type NotificationApi = {
  readonly permission: NotificationPermission
  requestPermission: () => Promise<NotificationPermission>
}

export const createSystemNotifications = (
  initialStorage: NotificationStorage | null,
  initialApi: NotificationApi | null
) => {
  const supported = ref(initialApi !== null)
  const permission = ref<NotificationPermission>(initialApi?.permission ?? 'default')
  const enabled = ref(false)
  let storage = initialStorage
  let api = initialApi

  const hydrate = (
    nextStorage: NotificationStorage | null,
    nextApi: NotificationApi | null
  ) => {
    storage = nextStorage
    api = nextApi
    supported.value = nextApi !== null
    permission.value = nextApi?.permission ?? 'default'
    try {
      enabled.value = nextStorage?.getItem(SYSTEM_NOTIFICATIONS_STORAGE_KEY) === 'enabled'
        && permission.value === 'granted'
    } catch {
      enabled.value = false
    }
  }

  const refreshPermission = () => {
    supported.value = api !== null
    permission.value = api?.permission ?? 'default'
    if (permission.value !== 'granted') {
      enabled.value = false
    }
  }

  const enable = async () => {
    if (!api) {
      return false
    }
    try {
      const nextPermission = api.permission === 'granted'
        ? 'granted'
        : await api.requestPermission()
      permission.value = nextPermission
      enabled.value = nextPermission === 'granted'
      storage?.setItem(
        SYSTEM_NOTIFICATIONS_STORAGE_KEY,
        enabled.value ? 'enabled' : 'disabled'
      )
      return enabled.value
    } catch {
      enabled.value = false
      refreshPermission()
      return false
    }
  }

  const disable = () => {
    enabled.value = false
    try {
      storage?.setItem(SYSTEM_NOTIFICATIONS_STORAGE_KEY, 'disabled')
    } catch {
      // Notification opt-in is best-effort when storage is unavailable.
    }
  }

  return {
    supported,
    enabled,
    permission,
    hydrate,
    refreshPermission,
    enable,
    disable
  }
}

let sharedSystemNotifications: ReturnType<typeof createSystemNotifications> | null = null

const resolveBrowserDependencies = () => {
  if (typeof window === 'undefined') {
    return {
      storage: null,
      api: null
    }
  }

  let storage: NotificationStorage | null = null
  try {
    storage = window.localStorage
  } catch {
    // Browser storage is optional.
  }

  return {
    storage,
    api: 'Notification' in window ? window.Notification : null
  }
}

export const useSystemNotifications = () => {
  if (!sharedSystemNotifications) {
    sharedSystemNotifications = createSystemNotifications(null, null)
  }

  if (import.meta.client) {
    onMounted(() => {
      const { storage, api } = resolveBrowserDependencies()
      sharedSystemNotifications?.hydrate(storage, api)
    })
  }

  return sharedSystemNotifications
}

import { describe, expect, it, vi } from 'vitest'
import {
  createSystemNotifications,
  SYSTEM_NOTIFICATIONS_STORAGE_KEY
} from '../app/composables/useSystemNotifications'

const createStorage = (initialValue: string | null = null) => {
  const values = new Map<string, string>()
  if (initialValue !== null) {
    values.set(SYSTEM_NOTIFICATIONS_STORAGE_KEY, initialValue)
  }
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    })
  }
}

const createApi = (initialPermission: NotificationPermission) => {
  let permission = initialPermission
  const requestPermission = vi.fn(async () => permission)
  return {
    api: {
      get permission() {
        return permission
      },
      requestPermission
    },
    setPermission(nextPermission: NotificationPermission) {
      permission = nextPermission
    },
    requestPermission
  }
}

describe('system notification preference', () => {
  it('hydrates stored opt-in only when browser permission is still granted', () => {
    const storage = createStorage('enabled')
    const granted = createApi('granted')
    const preference = createSystemNotifications(storage, granted.api)

    preference.hydrate(storage, granted.api)
    expect(preference.supported.value).toBe(true)
    expect(preference.permission.value).toBe('granted')
    expect(preference.enabled.value).toBe(true)
    expect(granted.requestPermission).not.toHaveBeenCalled()

    const denied = createApi('denied')
    preference.hydrate(storage, denied.api)
    expect(preference.permission.value).toBe('denied')
    expect(preference.enabled.value).toBe(false)
    expect(denied.requestPermission).not.toHaveBeenCalled()
  })

  it('requests permission only from enable and reacts to denied results', async () => {
    const storage = createStorage()
    const browser = createApi('default')
    const preference = createSystemNotifications(storage, browser.api)

    browser.setPermission('denied')
    await expect(preference.enable()).resolves.toBe(false)

    expect(browser.requestPermission).toHaveBeenCalledTimes(1)
    expect(preference.permission.value).toBe('denied')
    expect(preference.enabled.value).toBe(false)
    expect(storage.setItem).toHaveBeenCalledWith(
      SYSTEM_NOTIFICATIONS_STORAGE_KEY,
      'disabled'
    )
  })

  it('enables without another prompt when permission is granted and persists disable', async () => {
    const storage = createStorage('disabled')
    const browser = createApi('granted')
    const preference = createSystemNotifications(storage, browser.api)

    await expect(preference.enable()).resolves.toBe(true)
    expect(browser.requestPermission).not.toHaveBeenCalled()
    expect(preference.enabled.value).toBe(true)
    expect(storage.setItem).toHaveBeenLastCalledWith(
      SYSTEM_NOTIFICATIONS_STORAGE_KEY,
      'enabled'
    )

    preference.disable()
    expect(preference.enabled.value).toBe(false)
    expect(storage.setItem).toHaveBeenLastCalledWith(
      SYSTEM_NOTIFICATIONS_STORAGE_KEY,
      'disabled'
    )
  })

  it('keeps unsupported browsers explanatory and non-crashing', async () => {
    const preference = createSystemNotifications(createStorage(), null)

    expect(preference.supported.value).toBe(false)
    expect(preference.permission.value).toBe('default')
    await expect(preference.enable()).resolves.toBe(false)
  })
})

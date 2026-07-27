export const SETTINGS_SECTIONS = [
  {
    label: 'Notifications',
    icon: 'i-lucide-bell',
    path: '/settings/notifications'
  },
  {
    label: 'Voice',
    icon: 'i-lucide-audio-waveform',
    path: '/settings/voice'
  },
  {
    label: 'Backend',
    icon: 'i-lucide-server',
    path: '/settings/backend'
  }
] as const

export const DEFAULT_SETTINGS_ROUTE = SETTINGS_SECTIONS[0].path

export const resolveSettingsReturnTo = (value: unknown) => {
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || /^\/settings(?:[/?#]|$)/.test(value)
  ) {
    return '/'
  }

  return value
}

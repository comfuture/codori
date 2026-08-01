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
  },
  {
    label: 'Workspace',
    icon: 'i-lucide-folder-tree',
    path: '/settings/workspace'
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

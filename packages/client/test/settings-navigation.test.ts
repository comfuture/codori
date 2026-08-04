import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS_ROUTE,
  resolveSettingsReturnTo,
  SETTINGS_SECTIONS
} from '../shared/settings'

describe('settings navigation', () => {
  it('keeps a deterministic default and one route per section', () => {
    expect(DEFAULT_SETTINGS_ROUTE).toBe('/settings/general')
    expect(SETTINGS_SECTIONS.map(section => section.path)).toEqual([
      '/settings/general',
      '/settings/notifications',
      '/settings/voice',
      '/settings/backend'
    ])
    expect(SETTINGS_SECTIONS.map(section => section.label)).toEqual([
      'General',
      'Notifications',
      'Voice',
      'Backend'
    ])
    expect(SETTINGS_SECTIONS.every(section => section.icon.startsWith('i-lucide-')))
      .toBe(true)
  })

  it('accepts internal app routes and rejects settings loops or external targets', () => {
    expect(resolveSettingsReturnTo('/projects/codori/threads/thread-1?tab=files'))
      .toBe('/projects/codori/threads/thread-1?tab=files')
    expect(resolveSettingsReturnTo('/chats/chat-1')).toBe('/chats/chat-1')
    expect(resolveSettingsReturnTo('/settings/voice')).toBe('/')
    expect(resolveSettingsReturnTo('/settings?returnTo=/')).toBe('/')
    expect(resolveSettingsReturnTo('//example.com')).toBe('/')
    expect(resolveSettingsReturnTo('https://example.com')).toBe('/')
    expect(resolveSettingsReturnTo(['/projects/codori'])).toBe('/')
    expect(resolveSettingsReturnTo(undefined)).toBe('/')
  })
})

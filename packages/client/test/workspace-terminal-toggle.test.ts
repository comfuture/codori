// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WorkspaceTerminalToggle from '../app/components/WorkspaceTerminalToggle.vue'

const mountToggle = (id: string) => mount(WorkspaceTerminalToggle, {
  shallow: true,
  props: {
    workspace: { kind: 'project', id }
  },
  global: {
    renderStubDefaultSlot: true,
    stubs: {
      UTooltip: true,
      UButton: true
    }
  }
})

describe('WorkspaceTerminalToggle', () => {
  it('shares open state for the same workspace and isolates other workspaces', async () => {
    const first = mountToggle('terminal-toggle-shared')
    const second = mountToggle('terminal-toggle-shared')
    const other = mountToggle('terminal-toggle-other')

    expect(first.get('u-button-stub').attributes('aria-pressed')).toBe('false')
    expect(first.get('u-button-stub').attributes('aria-label')).toBe('Open workspace terminal')

    await first.get('u-button-stub').trigger('click')

    expect(first.get('u-button-stub').attributes('aria-pressed')).toBe('true')
    expect(second.get('u-button-stub').attributes('aria-pressed')).toBe('true')
    expect(second.get('u-button-stub').attributes('aria-label')).toBe('Hide workspace terminal')
    expect(other.get('u-button-stub').attributes('aria-pressed')).toBe('false')

    await second.get('u-button-stub').trigger('click')

    expect(first.get('u-button-stub').attributes('aria-pressed')).toBe('false')
    expect(second.get('u-button-stub').attributes('aria-pressed')).toBe('false')
  })
})

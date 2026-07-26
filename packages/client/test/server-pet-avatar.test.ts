// @vitest-environment jsdom

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import ServerPetAvatar from '../app/components/ServerPetAvatar.vue'
import type { ServerAvatarMetadata } from '../shared/server-avatar'

const avatar: ServerAvatarMetadata = {
  serverId: 'server-1',
  serverLabel: 'test',
  avatarId: 'pet-1',
  source: 'custom',
  displayName: 'Pet',
  description: 'Test pet',
  revision: 'revision-1',
  mimeType: 'image/png',
  frame: {
    width: 192,
    height: 208,
    columns: 8,
    rows: 9,
    frameCount: 72
  },
  animations: {
    idle: {
      frames: [
        { spriteIndex: 0, durationMs: 100 },
        { spriteIndex: 9, durationMs: 100 }
      ],
      loopStart: 0,
      fallback: 'idle'
    }
  }
}

const installMatchMedia = (matches = false) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
}

describe('ServerPetAvatar', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installMatchMedia()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('crops the spritesheet to a caller-controlled display size', async () => {
    const wrapper = mount(ServerPetAvatar, {
      props: {
        avatar,
        spriteUrl: 'blob:pet',
        width: 48
      }
    })
    await nextTick()

    expect(wrapper.attributes('style')).toContain('width: 48px')
    expect(wrapper.attributes('style')).toContain('height: 52px')
    expect(wrapper.attributes('style')).toContain('background-size: 384px 468px')
    expect(wrapper.attributes('style')).toContain('background-position: 0px 0px')

    await vi.advanceTimersByTimeAsync(100)
    await nextTick()
    expect(wrapper.attributes('style')).toContain('background-position: -48px -52px')
  })

  it('keeps the first frame when reduced motion is requested', async () => {
    installMatchMedia(true)
    const wrapper = mount(ServerPetAvatar, {
      props: {
        avatar,
        spriteUrl: 'blob:pet',
        width: 48
      }
    })
    await vi.advanceTimersByTimeAsync(500)
    await nextTick()
    expect(wrapper.attributes('style')).toContain('background-position: 0px 0px')
  })
})

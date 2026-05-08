import { describe, expect, it } from 'vitest'
import {
  CHAT_SCROLL_BOTTOM_THRESHOLD_PX,
  chatScrollDistanceFromBottom,
  isChatScrollNearBottom,
  resolveChatScrollPinnedState
} from '../app/utils/chat-scroll'

describe('chat scroll state', () => {
  it('treats scroll positions within 20px of the bottom as pinned', () => {
    expect(isChatScrollNearBottom({
      scrollHeight: 1000,
      scrollTop: 480,
      clientHeight: 500
    })).toBe(true)
    expect(chatScrollDistanceFromBottom({
      scrollHeight: 1000,
      scrollTop: 480,
      clientHeight: 500
    })).toBe(CHAT_SCROLL_BOTTOM_THRESHOLD_PX)
  })

  it('does not treat positions outside the threshold as pinned', () => {
    expect(isChatScrollNearBottom({
      scrollHeight: 1000,
      scrollTop: 479,
      clientHeight: 500
    })).toBe(false)
  })

  it('preserves the existing pin state before the first scroll measurement', () => {
    expect(resolveChatScrollPinnedState({
      wasPinned: true,
      previous: null,
      current: {
        scrollHeight: 1000,
        scrollTop: 0,
        clientHeight: 500
      }
    })).toBe(true)
  })

  it('keeps the transcript pinned when content grows after reaching the bottom', () => {
    expect(resolveChatScrollPinnedState({
      wasPinned: true,
      previous: {
        scrollHeight: 1000,
        scrollTop: 500,
        clientHeight: 500
      },
      current: {
        scrollHeight: 1120,
        scrollTop: 500,
        clientHeight: 500
      }
    })).toBe(true)
  })

  it('keeps the transcript pinned when the viewport shrinks after reaching the bottom', () => {
    expect(resolveChatScrollPinnedState({
      wasPinned: true,
      previous: {
        scrollHeight: 1000,
        scrollTop: 500,
        clientHeight: 500
      },
      current: {
        scrollHeight: 1000,
        scrollTop: 500,
        clientHeight: 440
      }
    })).toBe(true)
  })

  it('keeps the transcript pinned when collapsing content clamps scrollTop upward', () => {
    expect(resolveChatScrollPinnedState({
      wasPinned: true,
      previous: {
        scrollHeight: 1200,
        scrollTop: 700,
        clientHeight: 500
      },
      current: {
        scrollHeight: 1000,
        scrollTop: 500,
        clientHeight: 500
      }
    })).toBe(true)
  })

  it('does not stay pinned when the user scrolls upward', () => {
    expect(resolveChatScrollPinnedState({
      wasPinned: true,
      previous: {
        scrollHeight: 1000,
        scrollTop: 500,
        clientHeight: 500
      },
      current: {
        scrollHeight: 1000,
        scrollTop: 450,
        clientHeight: 500
      }
    })).toBe(false)
  })

  it('does not pin layout changes when the transcript was already unpinned', () => {
    expect(resolveChatScrollPinnedState({
      wasPinned: false,
      previous: {
        scrollHeight: 1000,
        scrollTop: 300,
        clientHeight: 500
      },
      current: {
        scrollHeight: 1120,
        scrollTop: 300,
        clientHeight: 500
      }
    })).toBe(false)
  })
})

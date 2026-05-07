import { describe, expect, it } from 'vitest'
import {
  CHAT_SCROLL_BOTTOM_THRESHOLD_PX,
  chatScrollDistanceFromBottom,
  isChatScrollNearBottom
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
})

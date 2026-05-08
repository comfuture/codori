export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 20
export const CHAT_SCROLL_TOP_TOLERANCE_PX = 1

export type ChatScrollMetrics = Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>

export const chatScrollDistanceFromBottom = (metrics: ChatScrollMetrics) =>
  Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight)

export const isChatScrollNearBottom = (
  metrics: ChatScrollMetrics,
  thresholdPx = CHAT_SCROLL_BOTTOM_THRESHOLD_PX
) => chatScrollDistanceFromBottom(metrics) <= thresholdPx

type ResolveChatScrollPinnedStateInput = {
  current: ChatScrollMetrics
  previous: ChatScrollMetrics | null
  wasPinned: boolean
  thresholdPx?: number
  scrollTopTolerancePx?: number
}

const maxScrollTop = (metrics: ChatScrollMetrics) =>
  Math.max(0, metrics.scrollHeight - metrics.clientHeight)

export const resolveChatScrollPinnedState = ({
  current,
  previous,
  wasPinned,
  thresholdPx = CHAT_SCROLL_BOTTOM_THRESHOLD_PX,
  scrollTopTolerancePx = CHAT_SCROLL_TOP_TOLERANCE_PX
}: ResolveChatScrollPinnedStateInput) => {
  if (isChatScrollNearBottom(current, thresholdPx)) {
    return true
  }

  if (!previous) {
    return wasPinned
  }

  if (!wasPinned) {
    return false
  }

  const layoutChanged = current.scrollHeight !== previous.scrollHeight
    || current.clientHeight !== previous.clientHeight
  if (!layoutChanged) {
    return false
  }

  const scrollTopMovedUp = current.scrollTop < previous.scrollTop - scrollTopTolerancePx
  const scrollableRangeShrank = maxScrollTop(current) < maxScrollTop(previous)
  return !scrollTopMovedUp || scrollableRangeShrank
}

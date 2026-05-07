export const CHAT_SCROLL_BOTTOM_THRESHOLD_PX = 20

type ChatScrollMetrics = Pick<HTMLElement, 'clientHeight' | 'scrollHeight' | 'scrollTop'>

export const chatScrollDistanceFromBottom = (metrics: ChatScrollMetrics) =>
  Math.max(0, metrics.scrollHeight - metrics.scrollTop - metrics.clientHeight)

export const isChatScrollNearBottom = (
  metrics: ChatScrollMetrics,
  thresholdPx = CHAT_SCROLL_BOTTOM_THRESHOLD_PX
) => chatScrollDistanceFromBottom(metrics) <= thresholdPx

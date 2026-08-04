// Tool calls, thread events, and voice delegations become `system` chat messages, and
// each one is its own `UChatMessage` article carrying the compact theme's
// `container: 'gap-1.5 pb-3'`. Trimming only that outer article padding keeps a run of
// tool calls reading as one sequence while every `UChatTool` trigger keeps its hit area.
export const COMPACT_SYSTEM_MESSAGE_CLASS =
  '[&>article[data-role=system]>[data-slot=container]]:pb-1'

export const chatTranscriptRootClass = () => [
  'min-h-full px-4 py-5 md:px-6',
  // Scroll anchoring relies on the last article not reserving `--last-message-height`.
  '[&>article:last-of-type]:!min-h-0',
  COMPACT_SYSTEM_MESSAGE_CLASS
].join(' ')

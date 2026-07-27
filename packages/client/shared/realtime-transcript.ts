import type { CodexRpcNotification } from './codex-rpc'

export type RealtimeTranscriptRole = 'user' | 'assistant' | 'unknown'

export type RealtimeTranscriptSegment = {
  id: number
  generation: number
  role: RealtimeTranscriptRole
  text: string
  final: boolean
}

export type RealtimeTranscriptState = {
  generation: number
  nextSegmentId: number
  segments: RealtimeTranscriptSegment[]
}

export type TranscriptVisibilityState = {
  generation: number
  signature: string
  visible: boolean
  hideAtMs: number | null
}

export const DEFAULT_TRANSCRIPT_INACTIVITY_MS = 5_000

export const createRealtimeTranscriptState = (
  generation = 0,
  nextSegmentId = 0
): RealtimeTranscriptState => ({
  generation,
  nextSegmentId,
  segments: []
})

export const resetRealtimeTranscript = (
  state: RealtimeTranscriptState,
  generation: number
): RealtimeTranscriptState => ({
  generation,
  nextSegmentId: state.nextSegmentId,
  segments: []
})

export const normalizeRealtimeTranscriptRole = (role: string): RealtimeTranscriptRole =>
  role === 'user' || role === 'assistant' ? role : 'unknown'

const notificationThreadId = (notification: CodexRpcNotification) => {
  const params = notification.params as { threadId?: unknown } | undefined
  return typeof params?.threadId === 'string' ? params.threadId : null
}

export const reduceRealtimeTranscriptNotification = (
  state: RealtimeTranscriptState,
  notification: CodexRpcNotification,
  context: {
    generation: number
    threadId: string
    started: boolean
  }
): RealtimeTranscriptState => {
  if (
    !context.started
    || notificationThreadId(notification) !== context.threadId
    || (
      notification.method !== 'thread/realtime/transcript/delta'
      && notification.method !== 'thread/realtime/transcript/done'
    )
  ) {
    return state
  }

  const current = state.generation === context.generation
    ? state
    : resetRealtimeTranscript(state, context.generation)
  const params = notification.params as {
    role: string
    delta?: string
    text?: string
  }
  const role = normalizeRealtimeTranscriptRole(params.role)
  const openIndex = current.segments.findLastIndex(segment =>
    segment.generation === context.generation
    && segment.role === role
    && !segment.final
  )

  if (notification.method === 'thread/realtime/transcript/delta') {
    const delta = params.delta ?? ''
    if (!delta) {
      return current
    }

    if (openIndex === -1) {
      const nextSegmentId = current.nextSegmentId + 1
      return {
        generation: context.generation,
        nextSegmentId,
        segments: [...current.segments, {
          id: nextSegmentId,
          generation: context.generation,
          role,
          text: delta,
          final: false
        }]
      }
    }

    return {
      ...current,
      segments: current.segments.map((segment, index) =>
        index === openIndex
          ? { ...segment, text: `${segment.text}${delta}` }
          : segment
      )
    }
  }

  const text = params.text ?? ''
  if (openIndex !== -1) {
    return {
      ...current,
      segments: current.segments.map((segment, index) =>
        index === openIndex
          ? { ...segment, text, final: true }
          : segment
      )
    }
  }

  const previous = current.segments.at(-1)
  if (
    previous?.generation === context.generation
    && previous.role === role
    && previous.final
    && previous.text === text
  ) {
    return current
  }

  const nextSegmentId = current.nextSegmentId + 1
  return {
    generation: context.generation,
    nextSegmentId,
    segments: [...current.segments, {
      id: nextSegmentId,
      generation: context.generation,
      role,
      text,
      final: true
    }]
  }
}

export const createTranscriptVisibilityState = (
  generation = 0
): TranscriptVisibilityState => ({
  generation,
  signature: '',
  visible: false,
  hideAtMs: null
})

export const transcriptSignature = (input: {
  segments: readonly RealtimeTranscriptSegment[]
  generation: number
  roles: readonly RealtimeTranscriptRole[]
}) => {
  const roles = new Set(input.roles)
  return input.segments
    .filter(segment =>
      segment.generation === input.generation
      && roles.has(segment.role)
      && Boolean(segment.text.trim())
    )
    .map(segment => `${segment.id}:${segment.role}:${segment.final ? 1 : 0}:${segment.text.trim()}`)
    .join('\u0000')
}

export const reconcileTranscriptVisibility = (
  state: TranscriptVisibilityState,
  input: {
    active: boolean
    segments: readonly RealtimeTranscriptSegment[]
    generation: number
    roles: readonly RealtimeTranscriptRole[]
    nowMs: number
    inactivityMs?: number
  }
): TranscriptVisibilityState => {
  const signature = input.active
    ? transcriptSignature(input)
    : ''
  if (!signature) {
    return createTranscriptVisibilityState(input.generation)
  }

  const changed = state.generation !== input.generation
    || state.signature !== signature
  if (changed) {
    return {
      generation: input.generation,
      signature,
      visible: true,
      hideAtMs: input.nowMs + Math.max(
        0,
        input.inactivityMs ?? DEFAULT_TRANSCRIPT_INACTIVITY_MS
      )
    }
  }

  return expireTranscriptVisibility(state, input.nowMs)
}

export const expireTranscriptVisibility = (
  state: TranscriptVisibilityState,
  nowMs: number
): TranscriptVisibilityState => {
  if (
    !state.visible
    || state.hideAtMs === null
    || nowMs < state.hideAtMs
  ) {
    return state
  }

  return {
    ...state,
    visible: false,
    hideAtMs: null
  }
}

export const resolveCurrentAssistantTranscript = (
  segments: readonly RealtimeTranscriptSegment[],
  generation: number
) => {
  const current = segments.filter(segment =>
    segment.generation === generation
    && (segment.role === 'user' || segment.role === 'assistant')
  )
  const latestUserIndex = current.findLastIndex(segment => segment.role === 'user')
  return current
    .slice(latestUserIndex + 1)
    .filter(segment => segment.role === 'assistant')
    .map(segment => segment.text.trim())
    .filter(Boolean)
    .join(' ')
}

import type {
  RealtimeSessionState,
  RealtimeTranscriptSegment
} from '../composables/useRealtimeConversation'

export type RealtimeVoiceCompanionEntry = {
  id: number
  generation: number
  role: 'user' | 'assistant'
  text: string
  final: boolean
}

export const isRealtimeVoiceCompanionActive = (state: RealtimeSessionState) =>
  state === 'requesting-permission'
  || state === 'creating-offer'
  || state === 'starting'
  || state === 'connected'
  || state === 'stopping'

export const resolveRealtimeVoiceCompanionEntries = (input: {
  transcripts: RealtimeTranscriptSegment[]
  generation: number
  maximumPairs?: number
}) => {
  const maximumPairs = Math.max(1, input.maximumPairs ?? 2)
  const segments: RealtimeVoiceCompanionEntry[] = input.transcripts
    .filter((segment): segment is RealtimeTranscriptSegment & {
      role: 'user' | 'assistant'
    } =>
      segment.generation === input.generation
      && (segment.role === 'user' || segment.role === 'assistant')
      && Boolean(segment.text.trim())
    )
    .map(segment => ({
      ...segment,
      text: segment.text.trim()
    }))

  const pairs: RealtimeVoiceCompanionEntry[][] = []
  for (const segment of segments) {
    const currentPair = pairs.at(-1)
    if (
      segment.role === 'assistant'
      && currentPair?.length === 1
      && currentPair[0]?.role === 'user'
    ) {
      currentPair.push(segment)
    } else {
      pairs.push([segment])
    }
  }

  return pairs.slice(-maximumPairs).flat()
}

export const resolveRealtimeVoiceAvatarWidth = (viewportWidth: number) =>
  Math.round(Math.min(88, Math.max(64, viewportWidth * 0.06)))

export const resolveCenteredRealtimeVoiceAvatarWidth = (viewportWidth: number) =>
  Math.round(Math.min(192, Math.max(128, viewportWidth * 0.12)))

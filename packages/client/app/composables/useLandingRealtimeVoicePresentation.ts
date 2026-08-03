import { useState } from '#imports'

export type LandingRealtimeVoicePresentation = {
  workspaceKey: string
  threadId: string
}

export const matchesLandingRealtimeVoicePresentation = (
  presentation: LandingRealtimeVoicePresentation | null,
  workspaceKey: string | null,
  threadId: string | null
) => Boolean(
  presentation
  && workspaceKey === presentation.workspaceKey
  && threadId === presentation.threadId
)

export const useLandingRealtimeVoicePresentation = () => {
  const presentation = useState<LandingRealtimeVoicePresentation | null>(
    'codori-landing-realtime-voice-presentation',
    () => null
  )

  const show = (nextPresentation: LandingRealtimeVoicePresentation) => {
    presentation.value = nextPresentation
  }

  const clear = (expected?: LandingRealtimeVoicePresentation) => {
    if (
      expected
      && !matchesLandingRealtimeVoicePresentation(
        presentation.value,
        expected.workspaceKey,
        expected.threadId
      )
    ) {
      return
    }
    presentation.value = null
  }

  return {
    presentation,
    show,
    clear
  }
}

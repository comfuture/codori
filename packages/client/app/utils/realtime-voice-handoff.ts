export type RealtimeVoiceCapabilityStatus =
  | 'checking'
  | 'available'
  | 'disabled'
  | 'unsupported'
  | 'insecure-context'
  | 'failed'

export const shouldHandoffRealtimeVoiceConnect = (input: {
  workspaceKind: 'project' | 'chat'
  routeThreadId: string | null
  pendingThreadId: string | null
  autoRedirectThreadId: string | null
  threadId: string
}) =>
  input.workspaceKind === 'project'
  && input.routeThreadId === null
  && (
    input.pendingThreadId === input.threadId
    || input.autoRedirectThreadId === input.threadId
  )

export type RealtimeVoiceHandoffAction = 'wait' | 'connect' | 'clear'

export const resolveRealtimeVoiceHandoffAction = (input: {
  pendingThreadId: string | null
  routeThreadId: string | null
  activeThreadId: string | null
  capabilityStatus: RealtimeVoiceCapabilityStatus
}): RealtimeVoiceHandoffAction => {
  if (!input.pendingThreadId || !input.routeThreadId) {
    return 'wait'
  }

  if (input.routeThreadId !== input.pendingThreadId) {
    return 'clear'
  }

  if (input.activeThreadId !== input.pendingThreadId || input.capabilityStatus === 'checking') {
    return 'wait'
  }

  return input.capabilityStatus === 'available' ? 'connect' : 'clear'
}

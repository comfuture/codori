import { readonly, shallowRef } from 'vue'
import type { RpcWorkspace } from './useRpc'

export type RealtimeVoiceWorkspaceContext = {
  workspace: RpcWorkspace
  workspaceKey: string
  threadId: string
}

const rememberedContext = shallowRef<RealtimeVoiceWorkspaceContext | null>(null)

export const rememberRealtimeVoiceWorkspaceContext = (
  context: RealtimeVoiceWorkspaceContext
) => {
  if (!context.workspace.id.trim() || !context.threadId.trim()) {
    return
  }

  rememberedContext.value = {
    workspace: { ...context.workspace },
    workspaceKey: context.workspaceKey,
    threadId: context.threadId
  }
}

export const useRealtimeVoiceWorkspaceContext = () => readonly(rememberedContext)

export const clearRealtimeVoiceWorkspaceContext = () => {
  rememberedContext.value = null
}

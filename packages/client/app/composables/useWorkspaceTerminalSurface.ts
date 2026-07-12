import { useState } from '#imports'
import { computed, toValue, type MaybeRefOrGetter } from 'vue'

export type WorkspaceTerminalScope = {
  kind: 'project' | 'chat'
  id: string
}

const toWorkspaceTerminalStateKey = (workspace: WorkspaceTerminalScope) =>
  `${workspace.kind}:${workspace.id}`

export const useWorkspaceTerminalSurface = (
  workspace: MaybeRefOrGetter<WorkspaceTerminalScope>
) => {
  const openByWorkspace = useState<Record<string, boolean>>(
    'workspace-terminal-surface-open',
    () => ({})
  )
  const stateKey = computed(() => toWorkspaceTerminalStateKey(toValue(workspace)))
  const open = computed({
    get: () => openByWorkspace.value[stateKey.value] ?? false,
    set: (value: boolean) => {
      if (value) {
        openByWorkspace.value[stateKey.value] = true
      } else {
        delete openByWorkspace.value[stateKey.value]
      }
    }
  })

  const toggle = () => {
    open.value = !open.value
  }

  return { open, toggle }
}

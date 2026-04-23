import { useState } from '#imports'
import type { WorkspaceLocalFileScope } from '../../shared/local-files'

export type LocalFileViewerState = {
  open: boolean
  workspace: WorkspaceLocalFileScope | null
  projectId: string | null
  path: string | null
  line: number | null
  column: number | null
}

const createClosedState = (): LocalFileViewerState => ({
  open: false,
  workspace: null,
  projectId: null,
  path: null,
  line: null,
  column: null
})

export const useLocalFileViewer = () => {
  const state = useState<LocalFileViewerState>('codori-local-file-viewer', createClosedState)

  const openViewer = (input: {
    workspace?: WorkspaceLocalFileScope
    projectId?: string
    path: string
    line?: number | null
    column?: number | null
  }) => {
    const workspace = input.workspace ?? (input.projectId ? { kind: 'project' as const, id: input.projectId } : null)
    if (!workspace) {
      return
    }

    state.value = {
      open: true,
      workspace,
      projectId: workspace.kind === 'project' ? workspace.id : null,
      path: input.path,
      line: input.line ?? null,
      column: input.column ?? null
    }
  }

  const closeViewer = () => {
    state.value = createClosedState()
  }

  return {
    state,
    openViewer,
    closeViewer
  }
}

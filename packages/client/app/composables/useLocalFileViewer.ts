import { useState } from '#imports'

export type LocalFileViewerState = {
  open: boolean
  projectId: string | null
  path: string | null
  line: number | null
  column: number | null
}

const createClosedState = (): LocalFileViewerState => ({
  open: false,
  projectId: null,
  path: null,
  line: null,
  column: null
})

export const useLocalFileViewer = () => {
  const state = useState<LocalFileViewerState>('codori-local-file-viewer', createClosedState)

  const openViewer = (input: {
    projectId: string
    path: string
    line?: number | null
    column?: number | null
  }) => {
    state.value = {
      open: true,
      projectId: input.projectId,
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

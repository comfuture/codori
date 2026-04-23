<script setup lang="ts">
import { computed } from 'vue'
import { useProjects } from '../../composables/useProjects'
import { useLocalFileViewer } from '../../composables/useLocalFileViewer'
import { isLocalFileWithinProject, parseLocalFileHref, type WorkspaceLocalFileScope } from '../../../shared/local-files'

const props = defineProps<{
  href?: string | null
  title?: string | null
  projectId?: string | null
  workspace?: WorkspaceLocalFileScope | null
  workspaceRootPath?: string | null
}>()

const { getProject } = useProjects()
const { openViewer } = useLocalFileViewer()

const parsedTarget = computed(() =>
  props.href ? parseLocalFileHref(props.href) : null
)
const workspaceScope = computed<WorkspaceLocalFileScope | null>(() =>
  props.workspace ?? (props.projectId ? { kind: 'project', id: props.projectId } : null)
)
const workspacePath = computed(() => {
  const workspace = workspaceScope.value
  if (!workspace) {
    return null
  }

  return props.workspaceRootPath
    ?? (workspace.kind === 'project' ? getProject(workspace.id)?.projectPath ?? null : null)
})
const isWorkspaceLocalFile = computed(() =>
  parsedTarget.value
  && isLocalFileWithinProject(parsedTarget.value.path, workspacePath.value)
)

const onClick = (event: MouseEvent) => {
  const workspace = workspaceScope.value
  if (!workspace || !parsedTarget.value || !isWorkspaceLocalFile.value) {
    return
  }

  event.preventDefault()
  openViewer({
    ...(workspace.kind === 'project' ? { projectId: workspace.id } : { workspace }),
    path: parsedTarget.value.path,
    line: parsedTarget.value.line,
    column: parsedTarget.value.column
  })
}
</script>

<template>
  <a
    :href="href ?? undefined"
    :title="title ?? undefined"
    class="underline decoration-primary/35 underline-offset-3 transition hover:text-primary hover:decoration-primary"
    @click="onClick"
  >
    <slot />
  </a>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useLocalFileViewer } from '../../composables/useLocalFileViewer'
import { parseLocalFileHref, type WorkspaceLocalFileScope } from '../../../shared/local-files'

const props = defineProps<{
  href?: string | null
  title?: string | null
  projectId?: string | null
  workspace?: WorkspaceLocalFileScope | null
}>()

const { openViewer } = useLocalFileViewer()

const parsedTarget = computed(() =>
  props.href ? parseLocalFileHref(props.href) : null
)
const workspaceScope = computed<WorkspaceLocalFileScope | null>(() =>
  props.workspace ?? (props.projectId ? { kind: 'project', id: props.projectId } : null)
)

const onLocalClick = () => {
  const workspace = workspaceScope.value
  if (!workspace || !parsedTarget.value) {
    return
  }

  openViewer({
    ...(workspace.kind === 'project' ? { projectId: workspace.id } : { workspace }),
    path: parsedTarget.value.path,
    line: parsedTarget.value.line,
    column: parsedTarget.value.column
  })
}
</script>

<template>
  <button
    v-if="parsedTarget"
    type="button"
    :title="title ?? undefined"
    class="cursor-pointer border-0 bg-transparent p-0 font-inherit text-inherit underline decoration-primary/35 underline-offset-3 transition hover:text-primary hover:decoration-primary"
    @click="onLocalClick"
  >
    <slot />
  </button>
  <a
    v-else
    :href="href ?? undefined"
    :title="title ?? undefined"
    class="underline decoration-primary/35 underline-offset-3 transition hover:text-primary hover:decoration-primary"
  >
    <slot />
  </a>
</template>

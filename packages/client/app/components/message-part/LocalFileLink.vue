<script setup lang="ts">
import { computed } from 'vue'
import { useProjects } from '../../composables/useProjects'
import { useLocalFileViewer } from '../../composables/useLocalFileViewer'
import { isLocalFileWithinProject, parseLocalFileHref } from '../../../shared/local-files'

const props = defineProps<{
  href?: string | null
  title?: string | null
  projectId?: string | null
}>()

const { getProject } = useProjects()
const { openViewer } = useLocalFileViewer()

const parsedTarget = computed(() =>
  props.href ? parseLocalFileHref(props.href) : null
)
const projectPath = computed(() =>
  props.projectId ? getProject(props.projectId)?.projectPath ?? null : null
)
const isProjectLocalFile = computed(() =>
  parsedTarget.value
  && isLocalFileWithinProject(parsedTarget.value.path, projectPath.value)
)

const onClick = (event: MouseEvent) => {
  if (!props.projectId || !parsedTarget.value || !isProjectLocalFile.value) {
    return
  }

  event.preventDefault()
  openViewer({
    projectId: props.projectId,
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

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useAttrs, watch } from 'vue'
import { useLocalFileViewer } from '../../composables/useLocalFileViewer'
import { useRpc } from '../../composables/useRpc'
import { parseLocalFileHref, type WorkspaceLocalFileScope } from '../../../shared/local-files'
import { readWorkspaceLocalFile } from '../../../shared/local-file-rpc'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  src?: string | null
  alt?: string | null
  title?: string | null
  projectId?: string | null
  workspace?: WorkspaceLocalFileScope | null
}>()

const attrs = useAttrs()
const { getWorkspaceClient } = useRpc()
const { openViewer } = useLocalFileViewer()
const target = computed(() => props.src ? parseLocalFileHref(props.src) : null)
const workspaceScope = computed<WorkspaceLocalFileScope | null>(() =>
  props.workspace ?? (props.projectId ? { kind: 'project', id: props.projectId } : null)
)
const objectUrl = ref<string | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const resourceKey = computed(() => [
  props.src ?? '',
  workspaceScope.value?.kind ?? '',
  workspaceScope.value?.id ?? ''
].join('\u0000'))

const revokeObjectUrl = () => {
  if (objectUrl.value) {
    URL.revokeObjectURL(objectUrl.value)
    objectUrl.value = null
  }
}

const decodeImage = (base64: string, mediaType: string) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mediaType })
}

watch(
  resourceKey,
  async (_resourceKey, _previousKey, onCleanup) => {
    let active = true
    onCleanup(() => {
      active = false
    })
    revokeObjectUrl()
    error.value = null

    const localTarget = target.value
    if (!localTarget) {
      loading.value = false
      return
    }

    const workspace = workspaceScope.value
    if (!workspace) {
      loading.value = false
      error.value = 'The local image workspace is unavailable.'
      return
    }

    loading.value = true
    try {
      const response = await readWorkspaceLocalFile(
        getWorkspaceClient(workspace),
        localTarget.path
      )
      if (!active) {
        return
      }
      if (response.file.kind !== 'image') {
        throw new Error('The referenced local file is not a supported image.')
      }
      objectUrl.value = URL.createObjectURL(
        decodeImage(response.file.base64, response.file.mediaType)
      )
    } catch (caughtError) {
      if (active) {
        error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
      }
    } finally {
      if (active) {
        loading.value = false
      }
    }
  },
  { immediate: true }
)

onBeforeUnmount(revokeObjectUrl)

const openFullViewer = () => {
  const workspace = workspaceScope.value
  const localTarget = target.value
  if (!workspace || !localTarget || !objectUrl.value) {
    return
  }

  openViewer({
    ...(workspace.kind === 'project' ? { projectId: workspace.id } : { workspace }),
    path: localTarget.path,
    line: localTarget.line,
    column: localTarget.column
  })
}
</script>

<template>
  <img
    v-if="!target"
    v-bind="attrs"
    :src="src ?? undefined"
    :alt="alt ?? ''"
    :title="title ?? undefined"
    loading="lazy"
    decoding="async"
  >
  <button
    v-else-if="objectUrl"
    type="button"
    class="inline-block max-w-full cursor-zoom-in border-0 bg-transparent p-0 align-middle"
    :aria-label="alt ? `Open ${alt}` : 'Open local image'"
    @click="openFullViewer"
  >
    <img
      v-bind="attrs"
      :src="objectUrl"
      :alt="alt ?? ''"
      :title="title ?? undefined"
      loading="lazy"
      decoding="async"
    >
  </button>
  <span
    v-else-if="loading"
    role="status"
    class="inline-flex min-h-24 min-w-40 items-center justify-center rounded-lg border border-default bg-elevated/30 px-4 py-3 text-xs text-muted"
    :aria-label="alt ? `Loading ${alt}` : 'Loading local image'"
  >
    Loading image…
  </span>
  <span
    v-else
    role="img"
    class="inline-flex min-h-24 min-w-40 items-center justify-center rounded-lg border border-error/30 bg-error/5 px-4 py-3 text-xs text-error"
    :aria-label="alt || 'Local image unavailable'"
    :title="error ?? undefined"
  >
    {{ alt || 'Local image unavailable' }}
  </span>
</template>

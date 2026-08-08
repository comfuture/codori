<script setup lang="ts">
import { Comark } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import { computed, nextTick, ref, watch } from 'vue'
import { useRuntimeConfig } from '#imports'
import { useRpc } from '../composables/useRpc'
import {
  formatLocalFileSize,
  resolveProjectLocalFileUrl,
  type ProjectLocalFileResponse,
  type WorkspaceLocalFileScope
} from '../../shared/local-files'
import { readWorkspaceLocalFile } from '../../shared/local-file-rpc'
import {
  buildHighlightedFileMarkdown,
  inferLocalFileLanguage,
  resolveLocalFileLanguageLabel
} from '../../shared/file-highlighting'

const props = withDefaults(defineProps<{
  workspace: WorkspaceLocalFileScope
  path: string
  line?: number | null
  eyebrow?: string
  transport?: 'http' | 'rpc'
}>(), {
  line: null,
  eyebrow: 'Local file viewer',
  transport: 'http'
})

const runtimeConfig = useRuntimeConfig()
const { getWorkspaceClient } = useRpc()
const loading = ref(false)
const error = ref<string | null>(null)
const file = ref<ProjectLocalFileResponse['file'] | null>(null)
const lineContainer = ref<HTMLElement | null>(null)
const viewerPlugins = [
  highlight({ preStyles: false })
]

const relativePathLabel = computed(() =>
  file.value?.relativePath || file.value?.name || props.path
)

const textFile = computed(() =>
  file.value?.kind === 'text' ? file.value : null
)

const imageFile = computed(() =>
  file.value?.kind === 'image' ? file.value : null
)

const lineCount = computed(() => {
  if (!textFile.value) {
    return 0
  }

  return textFile.value.text.split('\n').length
})

const inferredLanguage = computed(() =>
  textFile.value ? inferLocalFileLanguage(textFile.value.path, textFile.value.text) : null
)

const languageLabel = computed(() =>
  resolveLocalFileLanguageLabel(inferredLanguage.value)
)

const mediaTypeLabel = computed(() =>
  imageFile.value?.mediaType ?? null
)

const imagePreviewSrc = computed(() =>
  imageFile.value
    ? `data:${imageFile.value.mediaType};base64,${imageFile.value.base64}`
    : ''
)

const highlightedMarkdown = computed(() => {
  if (!textFile.value) {
    return ''
  }

  return buildHighlightedFileMarkdown(textFile.value.text, inferredLanguage.value)
})

const lineNumberWidth = computed(() =>
  `${Math.max(3, String(lineCount.value || 1).length + 1)}ch`
)

const updatedAtLabel = computed(() => {
  if (!file.value) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(new Date(file.value.updatedAt))
})

const isCurrentPreview = (workspace: WorkspaceLocalFileScope, path: string) =>
  props.workspace.kind === workspace.kind
  && props.workspace.id === workspace.id
  && props.path === path

const syncRenderedCodeLines = async () => {
  if (!textFile.value) {
    return
  }

  await nextTick()
  requestAnimationFrame(() => {
    if (!lineContainer.value || !textFile.value) {
      return
    }

    const renderedLines = Array.from(lineContainer.value.querySelectorAll<HTMLElement>('.line'))
    for (const [index, renderedLine] of renderedLines.entries()) {
      const lineNumber = index + 1
      renderedLine.dataset.fileLine = String(lineNumber)
      renderedLine.classList.toggle('is-target-line', props.line === lineNumber)
    }

    const targetLine = props.line
    if (!targetLine) {
      return
    }

    const target = lineContainer.value?.querySelector<HTMLElement>(`[data-file-line="${targetLine}"]`)
    target?.scrollIntoView({
      block: 'center'
    })
  })
}

watch(
  () => [props.workspace.kind, props.workspace.id, props.path] as const,
  async ([kind, id, path]) => {
    const workspace: WorkspaceLocalFileScope = { kind, id }
    loading.value = true
    error.value = null
    file.value = null

    try {
      const response = props.transport === 'rpc'
        ? await readWorkspaceLocalFile(getWorkspaceClient(workspace), path)
        : await $fetch<ProjectLocalFileResponse>(resolveProjectLocalFileUrl({
            workspace,
            path,
            configuredBase: String(runtimeConfig.public.serverBase ?? '')
          }))
      if (!isCurrentPreview(workspace, path)) {
        return
      }

      file.value = response.file
      await syncRenderedCodeLines()
    } catch (caughtError) {
      if (!isCurrentPreview(workspace, path)) {
        return
      }

      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    } finally {
      if (isCurrentPreview(workspace, path)) {
        loading.value = false
      }
    }
  },
  { immediate: true }
)

watch(() => props.line, () => {
  if (textFile.value) {
    void syncRenderedCodeLines()
  }
})

watch(highlightedMarkdown, () => {
  if (textFile.value) {
    void syncRenderedCodeLines()
  }
}, { flush: 'post' })
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-default">
    <header class="flex items-center justify-between gap-3 border-b border-default px-4 py-3">
      <div class="min-w-0 text-left">
        <div class="truncate text-xs font-medium text-primary">
          {{ eyebrow }}
        </div>
        <div class="truncate text-sm font-semibold text-highlighted">
          {{ relativePathLabel }}
        </div>
        <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span v-if="file">{{ formatLocalFileSize(file.size) }}</span>
          <span v-if="textFile">{{ lineCount }} lines</span>
          <span v-if="updatedAtLabel">{{ updatedAtLabel }}</span>
          <span v-if="mediaTypeLabel">{{ mediaTypeLabel }}</span>
          <span v-if="languageLabel">{{ languageLabel }}</span>
          <span v-if="textFile && line">Line {{ line }}</span>
        </div>
      </div>

      <div
        v-if="$slots.actions"
        class="shrink-0"
      >
        <slot name="actions" />
      </div>
    </header>

    <div
      v-if="loading"
      class="flex min-h-0 flex-1 items-center justify-center px-6 py-10 text-sm text-muted"
    >
      Loading local file preview...
    </div>

    <div
      v-else-if="error"
      class="flex min-h-0 flex-1 items-center justify-center px-6 py-10"
    >
      <UAlert
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        :title="error"
        class="w-full max-w-2xl"
      />
    </div>

    <div
      v-else-if="imageFile"
      class="local-file-viewer-image min-h-0 flex-1 overflow-auto bg-elevated/15"
    >
      <div class="flex min-h-full items-center justify-center p-6">
        <img
          class="max-h-full max-w-full object-contain"
          :src="imagePreviewSrc"
          :alt="imageFile.name"
        >
      </div>
    </div>

    <div
      v-else-if="textFile"
      ref="lineContainer"
      class="local-file-viewer-code min-h-0 flex-1 overflow-auto bg-elevated/15"
      :style="{ '--lfv-line-number-width': lineNumberWidth }"
    >
      <Suspense>
        <Comark
          class="local-file-viewer-markdown"
          :markdown="highlightedMarkdown"
          :plugins="viewerPlugins"
        />
      </Suspense>
    </div>
  </section>
</template>

<style scoped>
.local-file-viewer-code :deep(.local-file-viewer-markdown) {
  min-width: max-content;
}

.local-file-viewer-code :deep(.local-file-viewer-markdown > * + *) {
  margin-top: 0;
}

.local-file-viewer-code :deep(pre),
.local-file-viewer-code :deep(.shiki) {
  margin: 0;
  min-width: max-content;
  border: 0;
  border-radius: 0;
  padding: 0;
  background: transparent !important;
}

.local-file-viewer-code :deep(pre code),
.local-file-viewer-code :deep(.shiki code) {
  display: block;
  min-width: max-content;
  padding: 0;
}

.local-file-viewer-code :deep(.line) {
  display: block;
  min-width: max-content;
  padding: 0 1.5rem 0 0;
  padding-left: calc(var(--lfv-line-number-width) + 1.5rem);
  position: relative;
  white-space: pre;
}

.local-file-viewer-code :deep(.line::before) {
  content: attr(data-file-line);
  position: absolute;
  top: 0;
  left: 0;
  width: var(--lfv-line-number-width);
  padding-right: 0.75rem;
  text-align: right;
  color: var(--ui-text-muted);
  user-select: none;
  font-variant-numeric: tabular-nums;
}

.local-file-viewer-code :deep(.line.is-target-line) {
  background: color-mix(in srgb, var(--ui-primary) 10%, transparent);
}

.local-file-viewer-code :deep(.line.is-target-line::before) {
  color: var(--ui-primary);
}

.local-file-viewer-code :deep(.shiki),
.local-file-viewer-code :deep(.shiki code),
.local-file-viewer-code :deep(pre),
.local-file-viewer-code :deep(pre code) {
  font-size: 13px;
  line-height: 1.75;
}

:global(.dark) .local-file-viewer-code :deep(.shiki),
:global(.dark) .local-file-viewer-code :deep(.shiki span) {
  color: var(--shiki-dark) !important;
  background-color: var(--shiki-dark-bg) !important;
  font-style: var(--shiki-dark-font-style) !important;
  font-weight: var(--shiki-dark-font-weight) !important;
  text-decoration: var(--shiki-dark-text-decoration) !important;
}
</style>

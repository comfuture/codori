<script setup lang="ts">
import { Comark } from '@comark/vue'
import highlight from '@comark/vue/plugins/highlight'
import { computed, nextTick, ref, watch } from 'vue'
import { useRuntimeConfig } from '#imports'
import { useLocalFileViewer } from '../composables/useLocalFileViewer'
import { formatLocalFileSize, resolveProjectLocalFileUrl, type ProjectLocalFileResponse } from '../../shared/local-files'
import {
  buildHighlightedFileMarkdown,
  inferLocalFileLanguage,
  resolveLocalFileLanguageLabel
} from '../../shared/file-highlighting'

const runtimeConfig = useRuntimeConfig()
const { state, closeViewer } = useLocalFileViewer()

const loading = ref(false)
const error = ref<string | null>(null)
const file = ref<ProjectLocalFileResponse['file'] | null>(null)
const lineContainer = ref<HTMLElement | null>(null)
const viewerPlugins = [
  highlight({ preStyles: false })
]

const isOpen = computed({
  get: () => state.value.open,
  set: (open: boolean) => {
    if (!open) {
      closeViewer()
    }
  }
})

const relativePathLabel = computed(() => {
  if (!file.value) {
    return state.value.path ?? ''
  }

  return file.value.relativePath || file.value.name
})

const lineCount = computed(() => {
  if (!file.value) {
    return 0
  }

  return file.value.text.split('\n').length
})

const inferredLanguage = computed(() =>
  file.value ? inferLocalFileLanguage(file.value.path, file.value.text) : null
)

const languageLabel = computed(() =>
  resolveLocalFileLanguageLabel(inferredLanguage.value)
)

const highlightedMarkdown = computed(() => {
  if (!file.value) {
    return ''
  }

  return buildHighlightedFileMarkdown(file.value.text, inferredLanguage.value)
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

const syncRenderedCodeLines = async () => {
  if (!lineContainer.value) {
    return
  }

  await nextTick()
  requestAnimationFrame(() => {
    const renderedLines = Array.from(lineContainer.value?.querySelectorAll<HTMLElement>('.line') ?? [])
    for (const [index, line] of renderedLines.entries()) {
      const lineNumber = index + 1
      line.dataset.fileLine = String(lineNumber)
      line.classList.toggle('is-target-line', state.value.line === lineNumber)
    }

    const targetLine = state.value.line
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
  () => [state.value.open, state.value.projectId, state.value.path] as const,
  async ([open, projectId, path]) => {
    if (!open || !projectId || !path) {
      loading.value = false
      error.value = null
      file.value = null
      return
    }

    loading.value = true
    error.value = null
    file.value = null

    try {
      const response = await $fetch<ProjectLocalFileResponse>(resolveProjectLocalFileUrl({
        projectId,
        path,
        configuredBase: String(runtimeConfig.public.serverBase ?? '')
      }))
      if (!state.value.open || state.value.projectId !== projectId || state.value.path !== path) {
        return
      }

      file.value = response.file
      await syncRenderedCodeLines()
    } catch (caughtError) {
      if (!state.value.open || state.value.projectId !== projectId || state.value.path !== path) {
        return
      }

      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
    } finally {
      if (state.value.open && state.value.projectId === projectId && state.value.path === path) {
        loading.value = false
      }
    }
  },
  { immediate: true }
)

watch(() => state.value.line, () => {
  if (file.value) {
    void syncRenderedCodeLines()
  }
})

watch(highlightedMarkdown, () => {
  if (file.value) {
    void syncRenderedCodeLines()
  }
}, { flush: 'post' })
</script>

<template>
  <UModal
    v-model:open="isOpen"
    fullscreen
    :ui="{
      header: 'hidden',
      close: 'hidden',
      content: 'overflow-hidden bg-default',
      body: '!h-full !p-0'
    }"
  >
    <template #body>
      <section class="flex h-full min-h-0 flex-col bg-default">
        <header class="flex items-center justify-between gap-3 border-b border-default px-4 py-3">
          <div class="min-w-0">
            <div class="truncate text-xs font-medium uppercase tracking-[0.22em] text-primary">
              Local File Viewer
            </div>
            <div class="truncate text-sm font-semibold text-highlighted">
              {{ relativePathLabel }}
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span v-if="file">{{ formatLocalFileSize(file.size) }}</span>
              <span v-if="file">{{ lineCount }} lines</span>
              <span v-if="updatedAtLabel">{{ updatedAtLabel }}</span>
              <span v-if="languageLabel">{{ languageLabel }}</span>
              <span v-if="state.line">Line {{ state.line }}</span>
            </div>
          </div>

          <UButton
            icon="i-lucide-x"
            color="neutral"
            variant="ghost"
            size="sm"
            aria-label="Close local file viewer"
            @click="closeViewer"
          />
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
          v-else-if="file"
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
  </UModal>
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

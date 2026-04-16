<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRuntimeConfig } from '#imports'
import { useLocalFileViewer } from '../composables/useLocalFileViewer'
import { formatLocalFileSize, resolveProjectLocalFileUrl, type ProjectLocalFileResponse } from '../../shared/local-files'

const runtimeConfig = useRuntimeConfig()
const { state, closeViewer } = useLocalFileViewer()

const loading = ref(false)
const error = ref<string | null>(null)
const file = ref<ProjectLocalFileResponse['file'] | null>(null)
const lineContainer = ref<HTMLElement | null>(null)

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

const lineRows = computed(() => {
  if (!file.value) {
    return []
  }

  const lines = file.value.text.split('\n')
  return lines.map((line, index) => ({
    number: index + 1,
    text: line
  }))
})

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

const scrollToRequestedLine = async () => {
  const targetLine = state.value.line
  if (!targetLine || !lineContainer.value) {
    return
  }

  await nextTick()
  const target = lineContainer.value.querySelector<HTMLElement>(`[data-file-line="${targetLine}"]`)
  target?.scrollIntoView({
    block: 'center'
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
      await scrollToRequestedLine()
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
    void scrollToRequestedLine()
  }
})
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
              <span v-if="updatedAtLabel">{{ updatedAtLabel }}</span>
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
          class="min-h-0 flex-1 overflow-auto bg-elevated/20"
        >
          <div class="min-w-max px-4 py-4 sm:px-6">
            <div class="overflow-hidden rounded-2xl border border-default bg-default/85 shadow-sm">
              <div class="flex items-center justify-between border-b border-default px-4 py-2 text-xs text-muted">
                <span>{{ file.path }}</span>
                <span>{{ lineCount }} lines</span>
              </div>
              <div class="overflow-x-auto font-mono text-[13px] leading-6 text-highlighted">
                <div
                  v-for="row in lineRows"
                  :key="row.number"
                  :data-file-line="row.number"
                  class="grid grid-cols-[auto,1fr] gap-4 px-4"
                  :class="state.line === row.number ? 'bg-primary/10' : ''"
                >
                  <span class="select-none py-0.5 text-right tabular-nums text-muted">{{ row.number }}</span>
                  <span class="min-w-0 whitespace-pre-wrap break-all py-0.5">{{ row.text || ' ' }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </UModal>
</template>

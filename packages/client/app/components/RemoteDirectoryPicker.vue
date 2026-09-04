<script setup lang="ts">
import { computed, ref } from 'vue'
import { $fetch } from 'ofetch'
import { useRuntimeConfig } from '#imports'
import type { DirectoryBrowseResponse } from '~~/shared/codori'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'

const props = defineProps<{
  modelValue: string[]
  disabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [roots: string[]]
}>()

const runtimeConfig = useRuntimeConfig()
const configuredBase = String(runtimeConfig.public.serverBase ?? '')
const toApiUrl = (path: string) => shouldUseServerProxy(configuredBase)
  ? `/api/codori${path}`
  : resolveApiUrl(path, configuredBase)
const open = ref(false)
const path = ref('')
const separator = ref<'/' | '\\'>('/')
const entries = ref<DirectoryBrowseResponse['directory']['entries']>([])
const loading = ref(false)
const error = ref<string | null>(null)
let browseRequestId = 0

const pathRoot = (value: string, pathSeparator: '/' | '\\') => {
  if (pathSeparator === '\\') {
    const uncRoot = value.match(/^(\\\\[^\\]+\\[^\\]+)(?:\\|$)/u)?.[1]
    if (uncRoot) return uncRoot
    return value.match(/^([a-z]:\\)/iu)?.[1] ?? ''
  }
  return value.match(/^([a-z]:\/)/iu)?.[1] ?? (value.startsWith('/') ? '/' : '')
}

const crumbs = computed(() => {
  const root = pathRoot(path.value, separator.value)
  if (!root) return []
  const values = path.value.slice(root.length).split(separator.value).filter(Boolean)
  let currentPath = root
  return [
    { label: root, path: root },
    ...values.map((label) => {
      currentPath = `${currentPath.endsWith(separator.value) ? currentPath : `${currentPath}${separator.value}`}${label}`
      return { label, path: currentPath }
    })
  ]
})

const browse = async (nextPath: string | null = path.value) => {
  const normalized = nextPath?.trim() ?? ''
  if (nextPath !== null && !normalized) {
    error.value = 'Enter an absolute directory path.'
    return
  }
  if (nextPath !== null) path.value = normalized
  const requestId = ++browseRequestId
  loading.value = true
  error.value = null
  try {
    const response = await $fetch<DirectoryBrowseResponse>(
      toApiUrl('/projects/directories'),
      nextPath === null ? undefined : { query: { path: normalized } }
    )
    if (requestId !== browseRequestId) return
    path.value = response.directory.path
    separator.value = response.directory.separator
    entries.value = response.directory.entries.filter(entry => entry.isDirectory)
  } catch (caughtError) {
    if (requestId !== browseRequestId) return
    entries.value = []
    error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
  } finally {
    if (requestId === browseRequestId) loading.value = false
  }
}

const openPicker = () => {
  open.value = true
  path.value = ''
  separator.value = '/'
  entries.value = []
  error.value = null
  void browse(null)
}

const selectCurrent = () => {
  if (!path.value || props.modelValue.includes(path.value)) return
  emit('update:modelValue', [...props.modelValue, path.value])
}

const remove = (root: string) => emit('update:modelValue', props.modelValue.filter(value => value !== root))

const childPath = (name: string) => {
  const base = path.value.endsWith(separator.value) ? path.value : `${path.value}${separator.value}`
  return `${base}${name}`
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <p class="text-sm text-muted">
        Choose one or more folders.
      </p>
      <UButton
        type="button"
        size="sm"
        color="neutral"
        variant="outline"
        icon="i-lucide-folder-search"
        :disabled="disabled"
        @click="openPicker"
      >
        Browse folders
      </UButton>
    </div>

    <div
      v-if="modelValue.length"
      class="space-y-2 rounded-lg border border-default p-3"
    >
      <div
        v-for="root in modelValue"
        :key="root"
        class="flex items-center justify-between gap-3 text-sm"
      >
        <code class="min-w-0 truncate text-muted">{{ root }}</code>
        <UButton
          type="button"
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-x"
          :disabled="disabled"
          :aria-label="`Remove ${root}`"
          @click="remove(root)"
        />
      </div>
    </div>

    <UModal
      v-model:open="open"
      title="Browse folders"
    >
      <template #body>
        <UForm
          class="space-y-4"
          @submit.prevent="browse()"
        >
          <UFormField
            label="Absolute path"
            required
          >
            <div class="flex gap-2">
              <UInput
                v-model="path"
                autofocus
                placeholder="/home/ubuntu/Project"
                class="flex-1"
                :disabled="loading"
              />
              <UButton
                type="submit"
                :loading="loading"
              >
                Open
              </UButton>
            </div>
          </UFormField>

          <UBreadcrumb :items="crumbs">
            <template #item="{ item }">
              <button
                type="button"
                class="rounded text-sm text-muted hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
                :aria-current="item.path === path ? 'page' : undefined"
                @click="browse(item.path)"
              >
                {{ item.label }}
              </button>
            </template>
          </UBreadcrumb>

          <UAlert
            v-if="error"
            color="error"
            variant="soft"
            icon="i-lucide-circle-alert"
            :title="error"
          />

          <div class="max-h-72 overflow-y-auto rounded-lg border border-default">
            <UButton
              v-for="entry in entries"
              :key="entry.name"
              type="button"
              block
              color="neutral"
              variant="ghost"
              class="justify-start rounded-none px-3 py-2"
              icon="i-lucide-folder"
              @click="browse(childPath(entry.name))"
            >
              {{ entry.name }}
            </UButton>
            <p
              v-if="!loading && path && !entries.length"
              class="p-4 text-sm text-muted"
            >
              No child directories are available here.
            </p>
          </div>

          <div class="flex justify-end gap-2">
            <UButton
              type="button"
              color="neutral"
              variant="ghost"
              @click="open = false"
            >
              Close
            </UButton>
            <UButton
              type="button"
              :disabled="!path || modelValue.includes(path)"
              @click="selectCurrent"
            >
              Add this folder
            </UButton>
          </div>
        </UForm>
      </template>
    </UModal>
  </div>
</template>

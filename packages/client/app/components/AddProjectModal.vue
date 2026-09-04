<script setup lang="ts">
import type { FetchError } from 'ofetch'
import { computed, ref, watch } from 'vue'
import { useProjects } from '../composables/useProjects'
import { useCodoriRouter } from '../composables/useCodoriRouter'
import { toProjectRoute } from '../../shared/codori'

const props = withDefaults(defineProps<{
  open?: boolean
}>(), {
  open: false
})

const emit = defineEmits<{
  'update:open': [open: boolean]
}>()

const router = useCodoriRouter()
const {
  clonePending,
  createProject
} = useProjects()

const projectName = ref('')
const roots = ref<string[]>([])
const error = ref<string | null>(null)
const hasProjectName = computed(() => projectName.value.trim().length > 0)
const newIdempotencyKey = () => typeof globalThis.crypto?.randomUUID === 'function'
  ? `codori:${globalThis.crypto.randomUUID()}`
  : `codori:${Date.now()}:${Math.random().toString(36).slice(2)}`
const idempotencyKey = ref(newIdempotencyKey())

const isOpen = computed({
  get: () => props.open,
  set: (open: boolean) => {
    emit('update:open', open)
  }
})

const resetState = () => {
  projectName.value = ''
  roots.value = []
  error.value = null
  idempotencyKey.value = newIdempotencyKey()
}

watch(() => props.open, (open, previous) => {
  if (open && !previous) {
    resetState()
  }
})

const close = () => {
  if (clonePending.value) {
    return
  }

  isOpen.value = false
}

const inferProjectName = (path: string) => {
  const name = path.trim().replace(/[\\/]+$/u, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? ''
  return /^[a-z]:$/iu.test(name) ? '' : name
}

const updateRoots = (nextRoots: string[]) => {
  const addedRoot = nextRoots.find(root => !roots.value.includes(root))
  roots.value = nextRoots
  if (!hasProjectName.value && addedRoot) {
    projectName.value = inferProjectName(addedRoot)
  }
}

const toErrorMessage = (caughtError: unknown) => {
  const fetchError = caughtError as FetchError<{
    error?: {
      message?: string
    }
  }>
  return fetchError.data?.error?.message
    ?? (caughtError instanceof Error ? caughtError.message : String(caughtError))
}

const submit = async () => {
  if (clonePending.value) {
    return
  }

  const trimmedProjectName = projectName.value.trim()

  if (!trimmedProjectName) {
    error.value = 'Project name is required.'
    return
  }
  if (!roots.value.length) {
    error.value = 'Select at least one folder on the Codori server.'
    return
  }

  error.value = null

  try {
    const project = await createProject({
      name: trimmedProjectName,
      roots: roots.value,
      idempotencyKey: idempotencyKey.value
    })

    isOpen.value = false
    await router.push(toProjectRoute(project.projectId))
  } catch (caughtError) {
    error.value = toErrorMessage(caughtError)
  }
}
</script>

<template>
  <UModal
    v-model:open="isOpen"
    title="Add project"
    :dismissible="!clonePending"
  >
    <template #body>
      <form
        class="w-full space-y-4"
        @submit.prevent="submit"
      >
        <div class="w-full space-y-3">
          <UFormField
            label="Project name"
            required
            size="sm"
            class="w-full"
            :ui="{
              root: 'w-full',
              container: 'w-full'
            }"
          >
            <UInput
              v-model="projectName"
              autofocus
              placeholder="My project"
              size="sm"
              color="neutral"
              variant="subtle"
              class="w-full"
              :disabled="clonePending"
              :ui="{
                root: 'w-full',
                base: 'min-h-10 w-full rounded-lg px-3 text-sm'
              }"
            />
          </UFormField>

          <UFormField
            label="Folders"
            description="One or more absolute folder paths."
            size="sm"
            class="w-full"
            :ui="{
              root: 'w-full',
              container: 'w-full'
            }"
          >
            <RemoteDirectoryPicker
              :model-value="roots"
              :disabled="clonePending"
              @update:model-value="updateRoots"
            />
          </UFormField>
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="error"
        />

        <div class="flex items-center justify-end gap-2">
          <UButton
            type="button"
            color="neutral"
            variant="ghost"
            :disabled="clonePending"
            @click="close"
          >
            Cancel
          </UButton>
          <UButton
            type="submit"
            color="primary"
            :loading="clonePending"
            :disabled="clonePending || !hasProjectName"
          >
            Add project
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>

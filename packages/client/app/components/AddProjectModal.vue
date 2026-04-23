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
  cloneProject,
  refreshProjects
} = useProjects()

const repositoryUrl = ref('')
const destination = ref('')
const error = ref<string | null>(null)

const isOpen = computed({
  get: () => props.open,
  set: (open: boolean) => {
    emit('update:open', open)
  }
})

const resetState = () => {
  repositoryUrl.value = ''
  destination.value = ''
  error.value = null
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

  const trimmedRepositoryUrl = repositoryUrl.value.trim()
  const trimmedDestination = destination.value.trim()

  if (!trimmedRepositoryUrl) {
    error.value = 'Git repository URL is required.'
    return
  }

  error.value = null

  try {
    const project = await cloneProject({
      repositoryUrl: trimmedRepositoryUrl,
      destination: trimmedDestination || null
    })

    await refreshProjects()
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
        class="space-y-4"
        @submit.prevent="submit"
      >
        <div class="space-y-3">
          <UFormField
            label="Git repository URL"
            required
            size="sm"
          >
            <UInput
              v-model="repositoryUrl"
              autofocus
              placeholder="git@github.com:owner/repo.git"
              size="sm"
              color="neutral"
              variant="subtle"
              :disabled="clonePending"
              :ui="{
                base: 'min-h-10 rounded-lg px-3 text-sm'
              }"
            />
          </UFormField>

          <UFormField
            label="Directory name"
            description="Optional relative path under the configured Codori root."
            size="sm"
          >
            <UInput
              v-model="destination"
              placeholder="team/repo"
              size="sm"
              color="neutral"
              variant="subtle"
              :disabled="clonePending"
              :ui="{
                base: 'min-h-10 rounded-lg px-3 text-sm'
              }"
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
            :disabled="clonePending"
          >
            Clone project
          </UButton>
        </div>
      </form>
    </template>
  </UModal>
</template>

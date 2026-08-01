<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useProjectRoot } from '../composables/useProjectRoot'
import { useProjects } from '../composables/useProjects'

const {
  projectRoot,
  loading,
  saving,
  error,
  refreshProjectRoot,
  updateProjectRoot
} = useProjectRoot()
const { refreshProjects } = useProjects()

const draftRoot = ref('')
const savedRoot = ref<string | null>(null)

const isDirty = computed(() => draftRoot.value.trim() !== projectRoot.value.root)
const canSave = computed(() => isDirty.value && draftRoot.value.trim().length > 0 && !saving.value)

watch(() => projectRoot.value.root, (nextRoot) => {
  if (!isDirty.value || !draftRoot.value) {
    draftRoot.value = nextRoot
  }
}, { immediate: true })

const applyRoot = async () => {
  if (!canSave.value) {
    return
  }

  savedRoot.value = null
  try {
    const result = await updateProjectRoot(draftRoot.value)
    draftRoot.value = result.root
    savedRoot.value = result.root
    // The running server switched roots, so project discovery must be re-read.
    await refreshProjects()
  } catch {
    // The composable surfaces the message through `error`.
  }
}

const resetDraft = () => {
  draftRoot.value = projectRoot.value.root
  savedRoot.value = null
}

onMounted(() => {
  void refreshProjectRoot()
})
</script>

<template>
  <div class="divide-y divide-default">
    <div class="py-6">
      <label
        for="project-root-input"
        class="text-sm font-medium text-highlighted"
      >
        Project root directory
      </label>
      <p
        id="project-root-description"
        class="mt-2 max-w-xl text-sm leading-6 text-muted"
      >
        Codori discovers Git projects under this directory. Changing it applies to the running
        server immediately and is remembered the next time the service starts.
      </p>

      <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <UInput
          id="project-root-input"
          v-model="draftRoot"
          :loading="loading"
          :disabled="saving"
          class="w-full sm:max-w-lg"
          placeholder="/Users/you/Project"
          aria-describedby="project-root-description"
          @keydown.enter="applyRoot"
        />
        <div class="flex items-center gap-2">
          <UButton
            :loading="saving"
            :disabled="!canSave"
            color="primary"
            label="Apply"
            @click="applyRoot"
          />
          <UButton
            v-if="isDirty"
            :disabled="saving"
            color="neutral"
            variant="ghost"
            label="Reset"
            @click="resetDraft"
          />
        </div>
      </div>

      <p
        v-if="error"
        class="mt-3 text-sm text-error"
        role="alert"
      >
        {{ error }}
      </p>
      <p
        v-else-if="savedRoot"
        class="mt-3 text-sm text-success"
        role="status"
      >
        Now serving {{ savedRoot }}
      </p>
    </div>

    <div class="py-6">
      <h3 class="text-sm font-medium text-highlighted">
        Remembered service root
      </h3>
      <p class="mt-2 max-w-xl text-sm leading-6 text-muted">
        {{
          projectRoot.lastRoot
            ? `A registered service that starts without an explicit root uses ${projectRoot.lastRoot}.`
            : 'No service root has been recorded yet. It is saved the first time Codori serves a directory.'
        }}
      </p>
    </div>
  </div>
</template>

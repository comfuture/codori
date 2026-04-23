<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  currentBranch?: string | null
  branches?: string[]
  loading?: boolean
  submitting?: boolean
  disabled?: boolean
  error?: string | null
}>(), {
  currentBranch: null,
  branches: () => [],
  loading: false,
  submitting: false,
  disabled: false,
  error: null
})

const emit = defineEmits<{
  switchBranch: [branch: string]
  createBranch: [branch: string]
}>()

const newBranchName = ref('')

const hasGitBranchData = computed(() =>
  Boolean(props.currentBranch) || (props.branches?.length ?? 0) > 0
)

const availableBranches = computed(() =>
  (props.branches ?? []).filter(branch => branch !== props.currentBranch)
)

const createDisabled = computed(() =>
  props.loading
  || props.submitting
  || props.disabled
  || !newBranchName.value.trim()
)

const requestBranchCreate = () => {
  const branch = newBranchName.value.trim()
  if (!branch || createDisabled.value) {
    return
  }

  emit('createBranch', branch)
  newBranchName.value = ''
}
</script>

<template>
  <UPopover v-if="hasGitBranchData">
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      size="sm"
      icon="i-lucide-git-branch"
      :disabled="loading || submitting || disabled"
      class="rounded-full border border-default/70 bg-default/70"
      :ui="{ leadingIcon: 'size-4', base: 'min-w-0 px-3' }"
      data-workspace-branch-trigger=""
    >
      <span class="max-w-40 truncate">
        {{ currentBranch ?? 'Detached HEAD' }}
      </span>
    </UButton>

    <template #content>
      <div class="w-[min(20rem,calc(100vw-2rem))] space-y-2 p-2">
        <div
          class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm"
          data-current-branch=""
        >
          <UIcon
            name="i-lucide-git-branch"
            class="size-4 shrink-0 text-muted"
          />
          <span class="min-w-0 flex-1 truncate font-mono text-[13px] text-highlighted">
            {{ currentBranch ?? 'Detached HEAD' }}
          </span>
          <UIcon
            name="i-lucide-check"
            class="size-4 shrink-0 text-primary"
          />
        </div>

        <UAlert
          v-if="error"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :title="error"
        />

        <div class="max-h-56 overflow-y-auto">
          <div class="space-y-0.5">
            <button
              v-for="branch in availableBranches"
              :key="branch"
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition hover:bg-elevated"
              :disabled="loading || submitting || disabled"
              :data-branch-option="branch"
              @click="emit('switchBranch', branch)"
            >
              <span class="truncate font-mono text-[13px] text-highlighted">
                {{ branch }}
              </span>
            </button>

            <div
              v-if="!loading && !availableBranches.length"
              class="px-2 py-2 text-sm text-muted"
            >
              No other local branches.
            </div>
          </div>
        </div>

        <div class="flex items-center gap-2 border-t border-default pt-2">
          <UInput
            v-model="newBranchName"
            size="sm"
            color="neutral"
            variant="ghost"
            placeholder="create a branch"
            :disabled="loading || submitting || disabled"
            @keydown.enter.prevent="requestBranchCreate"
          />
          <UButton
            type="button"
            color="primary"
            variant="ghost"
            size="sm"
            :loading="submitting"
            :disabled="createDisabled"
            data-create-branch=""
            @click="requestBranchCreate"
          >
            Create
          </UButton>
        </div>
      </div>
    </template>
  </UPopover>
</template>

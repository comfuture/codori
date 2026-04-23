<script setup lang="ts">
import { computed, ref, watch } from 'vue'

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

const branchSearch = ref('')
const newBranchName = ref('')

const hasGitBranchData = computed(() =>
  Boolean(props.currentBranch) || (props.branches?.length ?? 0) > 0
)

const filteredBranches = computed(() => {
  const normalizedSearch = branchSearch.value.trim().toLowerCase()
  const availableBranches = (props.branches ?? []).filter(branch => branch !== props.currentBranch)
  if (!normalizedSearch) {
    return availableBranches
  }

  return availableBranches.filter(branch => branch.toLowerCase().includes(normalizedSearch))
})

const createDisabled = computed(() =>
  props.loading
  || props.submitting
  || props.disabled
  || !newBranchName.value.trim()
)

watch(() => props.currentBranch, () => {
  branchSearch.value = ''
})

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
      <div class="w-[min(24rem,calc(100vw-2rem))] space-y-3 p-3">
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Workspace Branch
            </div>
            <div class="truncate text-sm font-medium text-highlighted">
              {{ currentBranch ?? 'Detached HEAD' }}
            </div>
          </div>
          <UIcon
            name="i-lucide-git-branch"
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

        <div class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            Switch Branch
          </div>

          <UInput
            v-model="branchSearch"
            size="sm"
            color="neutral"
            variant="subtle"
            placeholder="Search local branches"
            :disabled="loading || submitting || disabled"
          />

          <div class="max-h-56 space-y-1 overflow-y-auto rounded-2xl border border-default bg-elevated/20 p-1">
            <button
              v-for="branch in filteredBranches"
              :key="branch"
              type="button"
              class="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition hover:bg-elevated"
              :disabled="loading || submitting || disabled"
              :data-branch-option="branch"
              @click="emit('switchBranch', branch)"
            >
              <span class="truncate font-mono text-[13px] text-highlighted">
                {{ branch }}
              </span>
              <UIcon
                name="i-lucide-arrow-right-left"
                class="size-3.5 shrink-0 text-muted"
              />
            </button>

            <div
              v-if="!loading && !filteredBranches.length"
              class="px-3 py-4 text-sm text-muted"
            >
              No matching local branches.
            </div>
          </div>
        </div>

        <div class="space-y-2">
          <div class="text-xs font-medium uppercase tracking-[0.16em] text-muted">
            Create Branch
          </div>

          <div class="flex items-center gap-2">
            <UInput
              v-model="newBranchName"
              size="sm"
              color="neutral"
              variant="subtle"
              placeholder="feature/new-branch"
              :disabled="loading || submitting || disabled"
              @keydown.enter.prevent="requestBranchCreate"
            />
            <UButton
              type="button"
              color="primary"
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
      </div>
    </template>
  </UPopover>
</template>

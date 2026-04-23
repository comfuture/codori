<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import BottomDrawerShell from './BottomDrawerShell.vue'

const props = withDefaults(defineProps<{
  open?: boolean
  mode?: 'target' | 'branch'
  branches?: string[]
  currentBranch?: string | null
  loading?: boolean
  submitting?: boolean
  error?: string | null
}>(), {
  open: false,
  mode: 'target',
  branches: () => [],
  currentBranch: null,
  loading: false,
  submitting: false,
  error: null
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  chooseCurrentChanges: []
  chooseBaseBranchMode: []
  chooseBaseBranch: [branch: string]
  back: []
}>()

const branchSearch = ref('')

watch(() => props.open, (open) => {
  if (!open) {
    branchSearch.value = ''
  }
})

watch(() => props.mode, (mode) => {
  if (mode !== 'branch') {
    branchSearch.value = ''
  }
})

const filteredBranches = computed(() => {
  const normalized = branchSearch.value.trim().toLowerCase()
  const branches = props.branches ?? []
  if (!normalized) {
    return branches
  }

  return branches.filter(branch => branch.toLowerCase().includes(normalized))
})

const branchGroups = computed(() => [{
  id: 'base-branches',
  items: filteredBranches.value.map(branch => ({
    label: branch,
    description: props.currentBranch ? `${props.currentBranch} -> ${branch}` : 'Compare against this branch.',
    disabled: props.loading || props.submitting,
    onSelect: () => emit('chooseBaseBranch', branch)
  }))
}])

const title = computed(() =>
  props.mode === 'branch'
    ? 'Select a base branch'
    : 'Start a review'
)

const description = computed(() =>
  props.mode === 'branch'
    ? 'Choose the branch to diff against before starting the review.'
    : 'Pick what Codori should review.'
)
</script>

<template>
  <BottomDrawerShell
    :open="open"
    :title="title"
    :description="description"
    :body-class="mode === 'branch' ? 'px-3 pb-3 pt-3 md:px-4 md:pb-4 md:pt-4' : 'px-4 pb-4 pt-2 md:px-5'"
    @update:open="emit('update:open', $event)"
  >
    <div
      v-if="mode === 'target'"
      class="space-y-3"
    >
      <button
        type="button"
        :disabled="submitting"
        class="flex w-full items-start justify-between gap-4 rounded-2xl border border-default bg-elevated/35 px-4 py-4 text-left transition hover:border-primary/30 hover:bg-elevated/55"
        @click="emit('chooseCurrentChanges')"
      >
        <div class="space-y-1">
          <div class="text-sm font-semibold text-highlighted">
            Review current changes
          </div>
          <p class="text-sm leading-6 text-muted">
            Review staged, unstaged, and untracked changes in the working tree.
          </p>
        </div>
        <UIcon
          name="i-lucide-git-compare-arrows"
          class="mt-0.5 size-5 shrink-0 text-primary"
        />
      </button>

      <button
        type="button"
        :disabled="submitting"
        class="flex w-full items-start justify-between gap-4 rounded-2xl border border-default bg-elevated/35 px-4 py-4 text-left transition hover:border-primary/30 hover:bg-elevated/55"
        @click="emit('chooseBaseBranchMode')"
      >
        <div class="space-y-1">
          <div class="text-sm font-semibold text-highlighted">
            Review against a base branch
          </div>
          <p class="text-sm leading-6 text-muted">
            Pick a local branch and review the diff from that base to your current branch.
          </p>
        </div>
        <UIcon
          name="i-lucide-git-branch-plus"
          class="mt-0.5 size-5 shrink-0 text-primary"
        />
      </button>
    </div>

    <div
      v-else
      class="space-y-3"
    >
      <div class="flex items-center justify-between gap-3">
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          icon="i-lucide-arrow-left"
          class="rounded-full"
          @click="emit('back')"
        >
          Back
        </UButton>

        <div
          v-if="currentBranch"
          class="text-xs font-medium text-muted"
        >
          Current {{ currentBranch }}
        </div>
      </div>

      <UAlert
        v-if="error"
        color="error"
        variant="soft"
        icon="i-lucide-circle-alert"
        :title="error"
      />

      <UCommandPalette
        v-model:search-term="branchSearch"
        :groups="branchGroups"
        :loading="loading || submitting"
        :disabled="submitting"
        placeholder="Search local branches"
        class="rounded-2xl border border-default bg-default/70"
        :ui="{
          root: 'min-h-0',
          content: 'max-h-[40vh] overflow-y-auto p-2',
          item: 'rounded-xl',
          input: 'border-0 bg-transparent'
        }"
      />

      <p
        v-if="!loading && !filteredBranches.length"
        class="rounded-2xl border border-dashed border-default px-4 py-6 text-center text-sm text-muted"
      >
        No matching local branches.
      </p>
    </div>
  </BottomDrawerShell>
</template>

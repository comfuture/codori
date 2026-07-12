<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import LocalFilePreview from './LocalFilePreview.vue'
import {
  useWorkspaceFiles,
  type WorkspaceFileTreeNode
} from '../composables/useWorkspaceFiles'
import { formatLocalFileSize, type WorkspaceLocalFileScope } from '../../shared/local-files'

const props = defineProps<{
  workspace: WorkspaceLocalFileScope
  workspaceLabel: string
}>()

const workspace = computed(() => props.workspace)
const {
  snapshot,
  treeItems,
  rootLoading,
  rootError,
  currentDirectoryError,
  breadcrumbs,
  selectedEntry,
  loadDirectory,
  selectEntry,
  navigateTo,
  refreshCurrentDirectory
} = useWorkspaceFiles(workspace)
const open = ref(false)
const copyStatus = ref<string | null>(null)

const breadcrumbItems = computed(() => breadcrumbs.value.map((item, index) => ({
  ...item,
  label: index === 0 ? props.workspaceLabel : item.label,
  active: index === breadcrumbs.value.length - 1
})))

const selectedNode = computed(() => {
  const selectedPath = snapshot.value.selectedPath
  if (!selectedPath) {
    return undefined
  }

  const findNode = (nodes: WorkspaceFileTreeNode[]): WorkspaceFileTreeNode | undefined => {
    for (const node of nodes) {
      if (node.key === selectedPath) {
        return node
      }
      const child = node.children ? findNode(node.children) : undefined
      if (child) {
        return child
      }
    }
    return undefined
  }

  return findNode(treeItems.value)
})

const copyTarget = computed(() => selectedEntry.value?.path ?? snapshot.value.currentPath)

const entryStatusLabel = (node: WorkspaceFileTreeNode) => {
  const entry = node.entry
  if (!entry || entry.accessible) {
    return null
  }

  switch (entry.errorCode) {
    case 'FORBIDDEN':
      return 'Outside workspace'
    case 'NOT_FOUND':
      return 'Unavailable'
    case 'PERMISSION_DENIED':
      return 'Permission denied'
    default:
      return 'Unsupported'
  }
}

const handleOpenChange = async (nextOpen: boolean) => {
  open.value = nextOpen
  if (nextOpen && !snapshot.value.listings['']) {
    await loadDirectory('')
  }
}

const handleTreeToggle = async (
  event: { detail: { isExpanded: boolean } },
  node: WorkspaceFileTreeNode
) => {
  const entry = node.entry
  if (!entry || entry.kind !== 'directory' || !entry.accessible) {
    return
  }

  selectEntry(entry)
  if (!event.detail.isExpanded && !snapshot.value.listings[entry.path]) {
    await loadDirectory(entry.path)
  }
}

const handleTreeSelect = (
  _event: Event,
  node: WorkspaceFileTreeNode
) => {
  const entry = node.entry
  if (!entry || !entry.accessible) {
    return
  }

  selectEntry(entry)
}

const handleSelectedNode = (node: WorkspaceFileTreeNode | undefined) => {
  if (node?.entry?.accessible) {
    selectEntry(node.entry)
  }
}

const copyRelativePath = async () => {
  if (!copyTarget.value) {
    return
  }

  const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (!clipboard?.writeText) {
    copyStatus.value = 'Could not copy the relative path.'
    return
  }

  try {
    await clipboard.writeText(copyTarget.value)
    copyStatus.value = `Copied ${copyTarget.value}`
  } catch {
    copyStatus.value = 'Could not copy the relative path.'
  }
}

watch(
  () => [props.workspace.kind, props.workspace.id] as const,
  () => {
    open.value = false
    copyStatus.value = null
  }
)

watch(copyTarget, () => {
  copyStatus.value = null
})

watch(open, (nextOpen) => {
  if (!nextOpen) {
    copyStatus.value = null
  }
})
</script>

<template>
  <UTooltip text="Workspace files">
    <UButton
      type="button"
      color="neutral"
      :variant="open ? 'soft' : 'outline'"
      size="sm"
      icon="i-lucide-folder-tree"
      square
      :aria-expanded="open"
      aria-label="Browse workspace files"
      @click="handleOpenChange(!open)"
    />
  </UTooltip>

  <UModal
    :open="open"
    title="Workspace files"
    fullscreen
    dismissible
    :ui="{
      content: 'overflow-hidden bg-default',
      header: 'px-4 py-3',
      body: 'min-h-0 overflow-hidden !p-0 sm:!p-0'
    }"
    @update:open="handleOpenChange"
  >
    <template #body>
      <div class="grid h-full min-h-0 grid-rows-[minmax(14rem,42%)_minmax(0,1fr)] bg-default md:grid-cols-[minmax(18rem,26rem)_minmax(0,1fr)] md:grid-rows-1">
        <aside class="flex min-h-0 flex-col border-b border-default bg-default md:border-r md:border-b-0">
          <div class="border-b border-default bg-elevated/20 px-4 py-3">
            <UBreadcrumb
              :items="breadcrumbItems"
              class="min-w-0 overflow-x-auto"
              :ui="{ list: 'flex-nowrap', linkLabel: 'max-w-32 truncate' }"
            >
              <template #item="{ item }">
                <button
                  type="button"
                  class="max-w-32 truncate rounded text-sm hover:text-highlighted focus-visible:outline-2 focus-visible:outline-primary"
                  :aria-current="item.active ? 'page' : undefined"
                  @click="navigateTo(item.path)"
                >
                  {{ item.label }}
                </button>
              </template>
            </UBreadcrumb>
          </div>

          <UScrollArea class="min-h-0 flex-1 px-2 py-3">
            <div
              v-if="rootLoading"
              class="space-y-2 px-2"
              aria-label="Loading workspace files"
            >
              <USkeleton
                v-for="index in 6"
                :key="index"
                class="h-8 w-full"
              />
            </div>

            <div
              v-else-if="rootError"
              class="space-y-3 px-2"
            >
              <UAlert
                color="error"
                variant="soft"
                icon="i-lucide-triangle-alert"
                title="Could not load workspace files"
                :description="rootError"
              />
              <UButton
                label="Retry"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="outline"
                size="sm"
                @click="loadDirectory('', { force: true })"
              />
            </div>

            <div
              v-else-if="currentDirectoryError"
              class="space-y-3 px-2 pb-3"
              role="status"
              aria-live="polite"
            >
              <UAlert
                color="error"
                variant="soft"
                icon="i-lucide-triangle-alert"
                title="Could not load folder"
                :description="currentDirectoryError"
              />
              <UButton
                label="Retry folder"
                icon="i-lucide-refresh-cw"
                color="neutral"
                variant="outline"
                size="sm"
                @click="loadDirectory(snapshot.currentPath, { force: true })"
              />
            </div>

            <UTree
              v-if="!rootLoading && !rootError"
              :items="treeItems"
              :get-key="(item: WorkspaceFileTreeNode) => item.key"
              :model-value="selectedNode"
              :expanded="snapshot.expandedPaths"
              color="primary"
              size="sm"
              class="w-full"
              :ui="{
                link: 'min-w-0 justify-start rounded-lg text-left',
                linkLabel: 'min-w-0 flex-1 text-left',
                linkLeadingIcon: 'shrink-0'
              }"
              @update:model-value="handleSelectedNode"
              @update:expanded="(paths: string[]) => { snapshot.expandedPaths = paths }"
              @toggle="handleTreeToggle"
              @select="handleTreeSelect"
            >
              <template #item-label="{ item }">
                <span
                  class="flex min-w-0 w-full items-center justify-start gap-2 text-left"
                  :class="item.status ? 'text-muted' : ''"
                >
                  <span class="min-w-0 flex-1 truncate">{{ item.label }}</span>
                  <UBadge
                    v-if="item.entry?.isSymlink"
                    color="neutral"
                    variant="subtle"
                    size="xs"
                  >
                    link
                  </UBadge>
                  <span
                    v-if="item.entry?.kind === 'file' && item.entry.size !== null"
                    class="shrink-0 text-[11px] text-dimmed"
                  >
                    {{ formatLocalFileSize(item.entry.size) }}
                  </span>
                  <span
                    v-if="entryStatusLabel(item)"
                    class="shrink-0 text-[11px] text-warning"
                  >
                    {{ entryStatusLabel(item) }}
                  </span>
                </span>
              </template>
            </UTree>
          </UScrollArea>

          <div
            class="flex min-h-12 items-center gap-2 border-t border-default bg-elevated/20 px-2 py-2"
            role="group"
            aria-label="File tree actions"
          >
            <p
              class="min-w-0 flex-1 truncate px-2 text-xs text-muted"
              :role="copyStatus ? 'status' : undefined"
            >
              {{ copyStatus ?? (copyTarget || 'Workspace root') }}
            </p>
            <div class="flex shrink-0 items-center gap-1">
              <UTooltip text="Refresh current folder">
                <UButton
                  icon="i-lucide-refresh-cw"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                  :loading="snapshot.loadingPaths.includes(snapshot.currentPath)"
                  aria-label="Refresh current folder"
                  @click="refreshCurrentDirectory"
                />
              </UTooltip>
              <UTooltip text="Copy relative path">
                <UButton
                  icon="i-lucide-copy"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                  :disabled="!copyTarget"
                  aria-label="Copy relative path"
                  @click="copyRelativePath"
                />
              </UTooltip>
            </div>
          </div>
        </aside>

        <section
          class="min-h-0 bg-elevated/10"
          aria-label="Workspace file preview"
        >
          <LocalFilePreview
            v-if="selectedEntry?.kind === 'file' && selectedEntry.accessible"
            :workspace="workspace"
            :path="selectedEntry.path"
            eyebrow="Workspace file preview"
          />
          <div
            v-else
            class="flex h-full min-h-0 flex-col items-center justify-center gap-4 px-6 py-10 text-center"
          >
            <UIcon
              name="i-lucide-file-search-2"
              class="size-12 text-muted/45"
              aria-hidden="true"
            />
            <p class="max-w-sm text-sm text-muted">
              Select a file from the tree to preview it.
            </p>
          </div>
        </section>
      </div>
    </template>
  </UModal>
</template>

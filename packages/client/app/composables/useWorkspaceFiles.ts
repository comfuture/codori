import { useRuntimeConfig, useState } from '#imports'
import { computed, type ComputedRef, type Ref } from 'vue'
import type { WorkspaceLocalFileScope } from '../../shared/local-files'
import {
  fallbackWorkspacePathAfterRemoval,
  resolveWorkspaceDirectoryUrl,
  workspacePathBreadcrumbs,
  type WorkspaceDirectoryEntry,
  type WorkspaceDirectoryListing,
  type WorkspaceDirectoryResponse
} from '../../shared/workspace-files'

export type WorkspaceFileTreeNode = {
  key: string
  label: string
  icon?: string
  disabled?: boolean
  entry?: WorkspaceDirectoryEntry
  status?: 'loading' | 'empty' | 'error' | 'truncated'
  children?: WorkspaceFileTreeNode[]
}

type WorkspaceFilesSnapshot = {
  generation: number
  listings: Record<string, WorkspaceDirectoryListing>
  loadingPaths: string[]
  errors: Record<string, string>
  expandedPaths: string[]
  selectedPath: string | null
  currentPath: string
  showIgnored: boolean
}

const createSnapshot = (): WorkspaceFilesSnapshot => ({
  generation: 0,
  listings: {},
  loadingPaths: [],
  errors: {},
  expandedPaths: [],
  selectedPath: null,
  currentPath: '',
  showIgnored: false
})

const scopeKeyFor = (workspace: WorkspaceLocalFileScope) => `${workspace.kind}:${workspace.id}`

const iconForEntry = (entry: WorkspaceDirectoryEntry) => {
  if (!entry.accessible) {
    return entry.isSymlink ? 'i-lucide-link-2-off' : 'i-lucide-file-warning'
  }
  if (entry.kind === 'directory') {
    return entry.isSymlink ? 'i-lucide-folder-symlink' : 'i-lucide-folder'
  }
  if (entry.isSymlink) {
    return 'i-lucide-file-symlink'
  }
  if (/\.(?:png|jpe?g|gif|webp|svg)$/iu.test(entry.name)) {
    return 'i-lucide-image'
  }
  if (/\.(?:md|mdx)$/iu.test(entry.name)) {
    return 'i-lucide-file-text'
  }
  if (/\.(?:js|jsx|ts|tsx|vue|css|scss|html|json|ya?ml|toml|rs|go|py|rb|java|kt|swift|sh)$/iu.test(entry.name)) {
    return 'i-lucide-file-code-2'
  }
  return 'i-lucide-file'
}

const statusNode = (
  directoryPath: string,
  status: WorkspaceFileTreeNode['status'],
  label: string
): WorkspaceFileTreeNode => ({
  key: `${directoryPath || 'root'}::__${status}`,
  label,
  status,
  disabled: true,
  icon: status === 'error'
    ? 'i-lucide-triangle-alert'
    : status === 'truncated'
      ? 'i-lucide-list-end'
      : status === 'loading'
        ? 'i-lucide-loader-circle'
        : 'i-lucide-folder-open'
})

export const useWorkspaceFiles = (
  workspace: Ref<WorkspaceLocalFileScope> | ComputedRef<WorkspaceLocalFileScope>
) => {
  const runtimeConfig = useRuntimeConfig()
  const snapshots = useState<Record<string, WorkspaceFilesSnapshot>>(
    'codori-workspace-files',
    () => ({})
  )
  const requestVersions = new Map<string, number>()
  const scopeKey = computed(() => scopeKeyFor(workspace.value))

  const ensureSnapshot = (key = scopeKey.value) => {
    snapshots.value[key] ??= createSnapshot()
    return snapshots.value[key]
  }

  const snapshot = computed(() => ensureSnapshot())

  const removeDescendantState = (directoryPath: string) => {
    const prefix = `${directoryPath}/`
    for (const path of Object.keys(snapshot.value.listings)) {
      if (path === directoryPath || path.startsWith(prefix)) {
        delete snapshot.value.listings[path]
        delete snapshot.value.errors[path]
      }
    }
    snapshot.value.expandedPaths = snapshot.value.expandedPaths.filter(
      path => path !== directoryPath && !path.startsWith(prefix)
    )
    if (
      snapshot.value.selectedPath === directoryPath
      || snapshot.value.selectedPath?.startsWith(prefix)
    ) {
      snapshot.value.selectedPath = null
    }
    snapshot.value.currentPath = fallbackWorkspacePathAfterRemoval(
      snapshot.value.currentPath,
      directoryPath
    )
  }

  const reconcileRemovedDirectories = (
    previous: WorkspaceDirectoryListing | undefined,
    next: WorkspaceDirectoryListing
  ) => {
    if (!previous) {
      return
    }

    const nextEntries = new Map(next.entries.map(entry => [entry.path, entry]))
    for (const entry of previous.entries) {
      const nextEntry = nextEntries.get(entry.path)
      if (!nextEntry) {
        if (snapshot.value.selectedPath === entry.path) {
          snapshot.value.selectedPath = null
        }
        if (entry.kind === 'directory') {
          removeDescendantState(entry.path)
        }
        continue
      }

      if (
        entry.kind === 'directory'
        && (nextEntry.kind !== 'directory' || !nextEntry.accessible)
      ) {
        removeDescendantState(entry.path)
      }
    }
  }

  const loadDirectory = async (path: string, options: { force?: boolean } = {}) => {
    const key = scopeKey.value
    const targetSnapshot = ensureSnapshot(key)
    if (targetSnapshot.listings[path] && !options.force) {
      return targetSnapshot.listings[path]
    }

    const generation = targetSnapshot.generation
    const requestKey = `${key}:${generation}:${path}`
    const version = (requestVersions.get(requestKey) ?? 0) + 1
    requestVersions.set(requestKey, version)
    targetSnapshot.loadingPaths = Array.from(new Set([...targetSnapshot.loadingPaths, path]))
    delete targetSnapshot.errors[path]
    const requestedWorkspace = { ...workspace.value }

    try {
      const response = await $fetch<WorkspaceDirectoryResponse>(resolveWorkspaceDirectoryUrl({
        workspace: requestedWorkspace,
        path,
        showIgnored: targetSnapshot.showIgnored,
        configuredBase: String(runtimeConfig.public.serverBase ?? '')
      }))

      if (
        scopeKey.value !== key
        || requestVersions.get(requestKey) !== version
        || ensureSnapshot(key).generation !== generation
      ) {
        return null
      }

      const activeSnapshot = ensureSnapshot(key)
      reconcileRemovedDirectories(activeSnapshot.listings[path], response.directory)
      activeSnapshot.listings[path] = response.directory
      delete activeSnapshot.errors[path]
      return response.directory
    } catch (error) {
      if (
        scopeKey.value === key
        && requestVersions.get(requestKey) === version
        && ensureSnapshot(key).generation === generation
      ) {
        ensureSnapshot(key).errors[path] = error instanceof Error
          ? error.message
          : String(error)
      }
      return null
    } finally {
      if (
        requestVersions.get(requestKey) === version
        && ensureSnapshot(key).generation === generation
      ) {
        const activeSnapshot = ensureSnapshot(key)
        activeSnapshot.loadingPaths = activeSnapshot.loadingPaths.filter(item => item !== path)
      }
    }
  }

  const childrenForDirectory = (directoryPath: string): WorkspaceFileTreeNode[] => {
    if (snapshot.value.loadingPaths.includes(directoryPath)) {
      return [statusNode(directoryPath, 'loading', 'Loading…')]
    }

    const error = snapshot.value.errors[directoryPath]
    if (error) {
      return [statusNode(directoryPath, 'error', error)]
    }

    const listing = snapshot.value.listings[directoryPath]
    if (!listing) {
      return [statusNode(directoryPath, 'loading', 'Expand to load')]
    }

    const nodes = listing.entries.map((entry): WorkspaceFileTreeNode => {
      const node: WorkspaceFileTreeNode = {
        key: entry.path,
        label: entry.name,
        entry,
        icon: iconForEntry(entry),
        disabled: !entry.accessible
      }

      if (entry.kind === 'directory' && entry.accessible) {
        node.children = childrenForDirectory(entry.path)
      }

      return node
    })

    if (nodes.length === 0) {
      nodes.push(statusNode(directoryPath, 'empty', 'This folder is empty.'))
    }
    if (listing.truncated) {
      nodes.push(statusNode(
        directoryPath,
        'truncated',
        `This directory is limited to ${listing.limit} entries.`
      ))
    }

    return nodes
  }

  const treeItems = computed(() => childrenForDirectory(''))
  const rootLoading = computed(() =>
    snapshot.value.loadingPaths.includes('') && !snapshot.value.listings['']
  )
  const rootError = computed(() => snapshot.value.errors[''] ?? null)
  const currentDirectoryError = computed(() =>
    snapshot.value.currentPath
      ? snapshot.value.errors[snapshot.value.currentPath] ?? null
      : null
  )
  const breadcrumbs = computed(() => workspacePathBreadcrumbs(snapshot.value.currentPath))
  const selectedEntry = computed(() => {
    const selectedPath = snapshot.value.selectedPath
    if (!selectedPath) {
      return null
    }
    for (const listing of Object.values(snapshot.value.listings)) {
      const entry = listing.entries.find(item => item.path === selectedPath)
      if (entry) {
        return entry
      }
    }
    return null
  })

  const selectEntry = (entry: WorkspaceDirectoryEntry) => {
    snapshot.value.selectedPath = entry.path
    snapshot.value.currentPath = entry.kind === 'directory'
      ? entry.path
      : entry.path.includes('/')
        ? entry.path.slice(0, entry.path.lastIndexOf('/'))
        : ''
  }

  const navigateTo = (path: string) => {
    snapshot.value.currentPath = path
    snapshot.value.selectedPath = path || null
    if (path) {
      const segments = path.split('/')
      snapshot.value.expandedPaths = Array.from(new Set([
        ...snapshot.value.expandedPaths,
        ...segments.map((_, index) => segments.slice(0, index + 1).join('/'))
      ]))
    }
  }

  const refreshCurrentDirectory = () => loadDirectory(snapshot.value.currentPath, { force: true })

  const directoryAncestors = (path: string) => {
    const segments = path ? path.split('/') : []
    return segments.map((_, index) => segments.slice(0, index + 1).join('/'))
  }

  const parentDirectoryPath = (path: string) =>
    path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''

  const setShowIgnored = async (showIgnored: boolean) => {
    const key = scopeKey.value
    const targetSnapshot = ensureSnapshot(key)
    if (targetSnapshot.showIgnored === showIgnored) {
      return
    }

    const generation = targetSnapshot.generation + 1
    const preservedExpandedPaths = [...targetSnapshot.expandedPaths]
    const preservedCurrentPath = targetSnapshot.currentPath
    const preservedSelectedPath = targetSnapshot.selectedPath

    targetSnapshot.showIgnored = showIgnored
    targetSnapshot.generation = generation
    targetSnapshot.listings = {}
    targetSnapshot.loadingPaths = []
    targetSnapshot.errors = {}
    await loadDirectory('', { force: true })
    if (scopeKey.value !== key || targetSnapshot.generation !== generation) {
      return
    }
    if (!targetSnapshot.listings['']) {
      targetSnapshot.expandedPaths = []
      targetSnapshot.selectedPath = null
      targetSnapshot.currentPath = ''
      return
    }

    const pathsToReload = Array.from(new Set([
      ...preservedExpandedPaths,
      ...directoryAncestors(preservedCurrentPath),
      ...directoryAncestors(parentDirectoryPath(preservedSelectedPath ?? ''))
    ])).sort((left, right) => {
      const depthDifference = left.split('/').length - right.split('/').length
      return depthDifference || (left < right ? -1 : left > right ? 1 : 0)
    })

    for (const path of pathsToReload) {
      if (scopeKey.value !== key || targetSnapshot.generation !== generation) {
        return
      }

      const parentPath = parentDirectoryPath(path)
      const entry = targetSnapshot.listings[parentPath]?.entries.find(item => item.path === path)
      if (!entry || entry.kind !== 'directory' || !entry.accessible) {
        removeDescendantState(path)
        continue
      }

      await loadDirectory(path, { force: true })
      if (scopeKey.value !== key || targetSnapshot.generation !== generation) {
        return
      }
    }

    if (targetSnapshot.selectedPath && !selectedEntry.value) {
      targetSnapshot.selectedPath = null
    }
  }

  return {
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
    refreshCurrentDirectory,
    setShowIgnored
  }
}

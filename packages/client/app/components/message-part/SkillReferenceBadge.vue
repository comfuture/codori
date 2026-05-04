<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue'
import { useProjects } from '../../composables/useProjects'
import { useRpc } from '../../composables/useRpc'
import {
  normalizeSkillsListResponse,
  type SkillAutocompleteEntry
} from '../../../shared/skill-autocomplete'
import type { WorkspaceLocalFileScope } from '../../../shared/local-files'

const props = defineProps<{
  name: string
  path?: string | null
  raw?: string | null
  projectId?: string | null
  workspace?: WorkspaceLocalFileScope | null
  workspaceRootPath?: string | null
}>()

const SKILL_FALLBACK_ICON = '🛠️'

const skillCatalogCache = new Map<string, Promise<SkillAutocompleteEntry[]>>()

const { getProject } = useProjects()
const { getWorkspaceClient } = useRpc()

const resolvedSkill = ref<SkillAutocompleteEntry | null>(null)

const badgeUi = {
  base: 'align-middle rounded-md bg-[#7c3aed]/15 px-1.5 py-0.5 text-[11px] font-bold text-[#d8b4fe] ring-1 ring-inset ring-[#a855f7]/30 dark:bg-[#7c3aed]/20 dark:text-[#e9d5ff] dark:ring-[#c084fc]/35'
}

const workspaceKey = computed(() => {
  if (props.workspace?.id) {
    return `${props.workspace.kind}:${props.workspace.id}`
  }

  if (props.projectId) {
    return `project:${props.projectId}`
  }

  return null
})

const workspaceCwd = computed(() => {
  if (props.workspaceRootPath) {
    return props.workspaceRootPath
  }

  return getProject(props.projectId ?? null)?.projectPath ?? null
})

const loadSkillCatalog = (workspace: WorkspaceLocalFileScope, cwd: string) => {
  const cacheKey = `${workspace.kind}:${workspace.id}:${cwd}`
  const existing = skillCatalogCache.get(cacheKey)
  if (existing) {
    return existing
  }

  const promise = getWorkspaceClient(workspace)
    .request('skills/list', { cwds: [cwd] })
    .then((response) => {
      const entries = normalizeSkillsListResponse(response)
      const entry = entries.find(candidate => candidate.cwd === cwd) ?? entries[0] ?? null
      return entry?.skills.filter(skill => skill.enabled) ?? []
    })
    .catch((error: unknown) => {
      skillCatalogCache.delete(cacheKey)
      throw error
    })

  skillCatalogCache.set(cacheKey, promise)
  return promise
}

const fallbackLabel = computed(() => {
  const normalizedName = props.name.replace(/^\$/u, '')
  return `${SKILL_FALLBACK_ICON}${normalizedName}`
})

const isCurrentSkill = (skill: SkillAutocompleteEntry) => {
  const normalizedName = props.name.replace(/^\$/u, '')
  const path = props.path ?? null
  if (path && skill.path !== path) {
    return false
  }

  return skill.name.toLowerCase() === normalizedName.toLowerCase()
}

const label = computed(() => {
  const skill = resolvedSkill.value
  if (!skill || !isCurrentSkill(skill)) {
    return fallbackLabel.value
  }

  return skill.displayName?.trim()
    || skill?.name
})

watchEffect(async (onCleanup) => {
  const name = props.name.replace(/^\$/u, '')
  const workspace = props.workspace
    ?? (props.projectId ? { kind: 'project' as const, id: props.projectId } : null)
  const cwd = workspaceCwd.value
  const key = workspaceKey.value
  const path = props.path ?? null

  let active = true
  onCleanup(() => {
    active = false
  })

  if (!workspace || !cwd || !key) {
    resolvedSkill.value = null
    return
  }

  try {
    const skills = await loadSkillCatalog(workspace, cwd)
    if (!active) {
      return
    }

    resolvedSkill.value = skills.find((skill) => {
      if (path && skill.path === path) {
        return true
      }

      return skill.name.toLowerCase() === name.toLowerCase()
    }) ?? null
  } catch {
    if (active) {
      resolvedSkill.value = null
    }
  }
})
</script>

<template>
  <UBadge
    as="span"
    color="primary"
    variant="soft"
    size="sm"
    :ui="badgeUi"
    :title="path ?? undefined"
  >
    {{ label }}
  </UBadge>
</template>

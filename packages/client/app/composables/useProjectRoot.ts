import { useRuntimeConfig, useState } from '#imports'
import { $fetch } from 'ofetch'
import { resolveApiUrl, shouldUseServerProxy } from '~~/shared/network'
import type { ProjectRootResponse, ProjectRootStatus } from '~~/shared/codori'

export const useProjectRoot = () => {
  const projectRoot = useState<ProjectRootStatus>('codori-project-root', () => ({
    root: '',
    lastRoot: null
  }))
  const loading = useState<boolean>('codori-project-root-loading', () => false)
  const saving = useState<boolean>('codori-project-root-saving', () => false)
  const error = useState<string | null>('codori-project-root-error', () => null)
  const configuredBase = String(useRuntimeConfig().public.serverBase ?? '')
  const useProxy = shouldUseServerProxy(configuredBase)

  const toApiUrl = (path: string) =>
    useProxy
      ? `/api/codori${path}`
      : resolveApiUrl(path, configuredBase)

  const refreshProjectRoot = async () => {
    if (loading.value) {
      return projectRoot.value
    }

    loading.value = true
    error.value = null
    try {
      const response = await $fetch<ProjectRootResponse>(toApiUrl('/config/root'))
      projectRoot.value = response.projectRoot
      return response.projectRoot
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
      return projectRoot.value
    } finally {
      loading.value = false
    }
  }

  const updateProjectRoot = async (root: string) => {
    const nextRoot = root.trim()
    if (!nextRoot || saving.value) {
      return projectRoot.value
    }

    saving.value = true
    error.value = null
    try {
      const response = await $fetch<ProjectRootResponse>(toApiUrl('/config/root'), {
        method: 'PATCH',
        body: {
          root: nextRoot
        }
      })
      projectRoot.value = response.projectRoot
      return response.projectRoot
    } catch (caughtError) {
      error.value = caughtError instanceof Error ? caughtError.message : String(caughtError)
      throw caughtError
    } finally {
      saving.value = false
    }
  }

  return {
    projectRoot,
    loading,
    saving,
    error,
    refreshProjectRoot,
    updateProjectRoot
  }
}

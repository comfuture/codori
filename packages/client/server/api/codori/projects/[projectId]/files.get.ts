import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam
} from 'h3'
import { encodeProjectIdSegment } from '~~/shared/codori'
import type { WorkspaceDirectoryResponse } from '~~/shared/workspace-files'
import { proxyServerRequest } from '../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing project id.'
    })
  }

  const query = getQuery(event)
  const path = typeof query.path === 'string' ? query.path : ''
  const params = new URLSearchParams({ path })
  if (query.showIgnored === 'true') {
    params.set('showIgnored', 'true')
  }

  try {
    return await proxyServerRequest<WorkspaceDirectoryResponse>(
      event,
      `/api/projects/${encodeProjectIdSegment(projectId)}/files?${params.toString()}`
    )
  } catch (error) {
    const details = error as { statusCode?: number, statusMessage?: string }
    throw createError({
      statusCode: details.statusCode ?? 500,
      statusMessage: details.statusMessage ?? 'Workspace directory listing failed.'
    })
  }
})

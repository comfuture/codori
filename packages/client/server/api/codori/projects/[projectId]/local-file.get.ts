import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam
} from 'h3'
import { encodeProjectIdSegment } from '~~/shared/codori'
import type { ProjectLocalFileResponse } from '~~/shared/local-files'
import { proxyServerRequest } from '../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing project id.'
    })
  }

  const queryValue = getQuery(event).path
  const path = typeof queryValue === 'string'
    ? queryValue
    : ''

  if (!path) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing local file path.'
    })
  }

  try {
    return await proxyServerRequest<ProjectLocalFileResponse>(
      event,
      `/api/projects/${encodeProjectIdSegment(projectId)}/local-file?${new URLSearchParams({ path }).toString()}`
    )
  } catch (error) {
    const details = error as { statusCode?: number, statusMessage?: string }
    throw createError({
      statusCode: details.statusCode ?? 500,
      statusMessage: details.statusMessage ?? 'Local file preview failed.'
    })
  }
})

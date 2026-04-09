import { createError, defineEventHandler, getRouterParam } from 'h3'
import type { ProjectResponse } from '~~/shared/codori.js'
import { encodeProjectIdSegment } from '~~/shared/codori.js'
import { proxyServerRequest } from '../../../utils/server-proxy.js'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing project id.'
    })
  }

  return await proxyServerRequest<ProjectResponse>(event, `/api/projects/${encodeProjectIdSegment(projectId)}`)
})

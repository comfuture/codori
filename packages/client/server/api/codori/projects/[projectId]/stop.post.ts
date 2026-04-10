import { defineEventHandler, getRouterParam } from 'h3'
import { encodeProjectIdSegment } from '~~/shared/codori.js'
import type { ProjectResponse } from '~~/shared/codori.js'
import { proxyServerRequest } from '../../../../utils/server-proxy.js'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw new Error('Missing project id.')
  }

  return await proxyServerRequest<ProjectResponse>(
    event,
    `/api/projects/${encodeProjectIdSegment(projectId)}/stop`,
    { method: 'POST' }
  )
})

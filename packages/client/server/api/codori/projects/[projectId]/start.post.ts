import { createError, defineEventHandler, getRouterParam } from 'h3'
import { encodeProjectIdSegment, type ProjectResponse } from '../../../../../shared/codori.js'
import { proxyCodoriRequest } from '../../../../utils/codori-server.js'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing project id.'
    })
  }

  return await proxyCodoriRequest<ProjectResponse>(event, `/api/projects/${encodeProjectIdSegment(projectId)}/start`, {
    method: 'POST'
  })
})

import { defineEventHandler, readBody } from 'h3'
import type { CloneProjectRequest, ProjectResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const body = await readBody<CloneProjectRequest>(event)

  return await proxyServerRequest<ProjectResponse>(
    event,
    '/api/projects/clone',
    {
      method: 'POST',
      body
    }
  )
})

import { defineEventHandler, readBody } from 'h3'
import type { ProjectRootResponse, UpdateProjectRootRequest } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const body = await readBody<UpdateProjectRootRequest>(event)

  return await proxyServerRequest<ProjectRootResponse>(event, '/api/config/root', {
    method: 'PATCH',
    body: {
      root: body?.root ?? ''
    }
  })
})

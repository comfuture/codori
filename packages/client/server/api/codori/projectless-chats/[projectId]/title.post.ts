import { defineEventHandler, getRouterParam, readBody } from 'h3'
import {
  encodeProjectIdSegment,
  type ProjectResponse,
  type UpdateProjectlessChatTitleRequest
} from '~~/shared/codori'
import { proxyServerRequest } from '../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw new Error('Missing project id.')
  }

  const body = await readBody<UpdateProjectlessChatTitleRequest>(event)
  return await proxyServerRequest<ProjectResponse>(
    event,
    `/api/projectless-chats/${encodeProjectIdSegment(projectId)}/title`,
    {
      method: 'POST',
      body
    }
  )
})

import { defineEventHandler, getRouterParam } from 'h3'
import { encodeProjectIdSegment, type DeleteProjectlessChatResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw new Error('Missing project id.')
  }

  return await proxyServerRequest<DeleteProjectlessChatResponse>(
    event,
    `/api/projectless-chats/${encodeProjectIdSegment(projectId)}`,
    { method: 'DELETE' }
  )
})

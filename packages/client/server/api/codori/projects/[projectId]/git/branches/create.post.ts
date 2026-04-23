import { defineEventHandler, getRouterParam, readBody } from 'h3'
import {
  encodeProjectIdSegment,
  type ProjectGitBranchMutationRequest,
  type ProjectGitBranchesResponse
} from '~~/shared/codori'
import { proxyServerRequest } from '../../../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw new Error('Missing project id.')
  }

  const body = await readBody<ProjectGitBranchMutationRequest>(event)
  return await proxyServerRequest<ProjectGitBranchesResponse>(
    event,
    `/api/projects/${encodeProjectIdSegment(projectId)}/git/branches/create`,
    {
      method: 'POST',
      body
    }
  )
})

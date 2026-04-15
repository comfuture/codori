import { defineEventHandler, getRouterParam } from 'h3'
import { encodeProjectIdSegment, type ProjectGitBranchesResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const projectId = getRouterParam(event, 'projectId')
  if (!projectId) {
    throw new Error('Missing project id.')
  }

  return await proxyServerRequest<ProjectGitBranchesResponse>(
    event,
    `/api/projects/${encodeProjectIdSegment(projectId)}/git/branches`
  )
})

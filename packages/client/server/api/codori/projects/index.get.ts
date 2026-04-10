import { defineEventHandler } from 'h3'
import type { ProjectsResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<ProjectsResponse>(event, '/api/projects')
)

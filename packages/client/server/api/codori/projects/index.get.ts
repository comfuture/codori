import { defineEventHandler } from 'h3'
import type { ProjectsResponse } from '~~/shared/codori.js'
import { proxyServerRequest } from '../../../utils/server-proxy.js'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<ProjectsResponse>(event, '/api/projects')
)

import { defineEventHandler } from 'h3'
import type { ProjectRootResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<ProjectRootResponse>(event, '/api/config/root')
)

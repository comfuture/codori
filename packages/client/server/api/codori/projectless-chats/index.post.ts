import { defineEventHandler } from 'h3'
import type { ProjectResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<ProjectResponse>(event, '/api/projectless-chats', {
    method: 'POST'
  })
)

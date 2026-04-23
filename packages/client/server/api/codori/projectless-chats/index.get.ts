import { defineEventHandler } from 'h3'
import type { ProjectlessChatsResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<ProjectlessChatsResponse>(event, '/api/projectless-chats')
)

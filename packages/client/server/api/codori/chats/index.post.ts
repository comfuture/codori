import { defineEventHandler } from 'h3'
import type { ChatResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<ChatResponse>(event, '/api/chats', {
    method: 'POST'
  })
)

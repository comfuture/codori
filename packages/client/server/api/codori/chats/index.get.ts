import { defineEventHandler } from 'h3'
import type { ChatsResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) =>
  await proxyServerRequest<ChatsResponse>(event, '/api/chats')
)

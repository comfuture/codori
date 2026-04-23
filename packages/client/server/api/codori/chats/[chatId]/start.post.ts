import { defineEventHandler, getRouterParam } from 'h3'
import { encodeChatIdSegment, type ChatResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const chatId = getRouterParam(event, 'chatId')
  return await proxyServerRequest<ChatResponse>(event, `/api/chats/${encodeChatIdSegment(chatId ?? '')}/start`, {
    method: 'POST'
  })
})

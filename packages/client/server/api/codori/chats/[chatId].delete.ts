import { defineEventHandler, getRouterParam } from 'h3'
import { encodeChatIdSegment, type DeleteChatResponse } from '~~/shared/codori'
import { proxyServerRequest } from '../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const chatId = getRouterParam(event, 'chatId')
  return await proxyServerRequest<DeleteChatResponse>(event, `/api/chats/${encodeChatIdSegment(chatId ?? '')}`, {
    method: 'DELETE'
  })
})

import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { encodeChatIdSegment, type ChatResponse, type UpdateChatThreadRequest } from '~~/shared/codori'
import { proxyServerRequest } from '../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const chatId = getRouterParam(event, 'chatId')
  const body = await readBody<UpdateChatThreadRequest>(event)
  return await proxyServerRequest<ChatResponse>(event, `/api/chats/${encodeChatIdSegment(chatId ?? '')}/thread`, {
    method: 'POST',
    body
  })
})

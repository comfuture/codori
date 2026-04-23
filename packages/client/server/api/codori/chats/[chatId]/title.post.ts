import { defineEventHandler, getRouterParam, readBody } from 'h3'
import { encodeChatIdSegment, type ChatResponse, type UpdateChatTitleRequest } from '~~/shared/codori'
import { proxyServerRequest } from '../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const chatId = getRouterParam(event, 'chatId')
  const body = await readBody<UpdateChatTitleRequest>(event)
  return await proxyServerRequest<ChatResponse>(event, `/api/chats/${encodeChatIdSegment(chatId ?? '')}/title`, {
    method: 'POST',
    body
  })
})

import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam
} from 'h3'
import { encodeChatIdSegment } from '~~/shared/codori'
import type { ProjectLocalFileResponse } from '~~/shared/local-files'
import { proxyServerRequest } from '../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const chatId = getRouterParam(event, 'chatId')
  const queryValue = getQuery(event).path
  const path = typeof queryValue === 'string'
    ? queryValue
    : ''

  if (!chatId || !path) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing local file path.'
    })
  }

  try {
    return await proxyServerRequest<ProjectLocalFileResponse>(
      event,
      `/api/chats/${encodeChatIdSegment(chatId)}/local-file?${new URLSearchParams({ path }).toString()}`
    )
  } catch (error) {
    const details = error as { statusCode?: number, statusMessage?: string }
    throw createError({
      statusCode: details.statusCode ?? 500,
      statusMessage: details.statusMessage ?? 'Local file preview failed.'
    })
  }
})

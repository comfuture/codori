import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam
} from 'h3'
import { encodeChatIdSegment } from '~~/shared/codori'
import type { WorkspaceDirectoryResponse } from '~~/shared/workspace-files'
import { proxyServerRequest } from '../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const chatId = getRouterParam(event, 'chatId')
  if (!chatId) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing chat id.'
    })
  }

  const query = getQuery(event)
  const path = typeof query.path === 'string' ? query.path : ''
  const params = new URLSearchParams({ path })
  if (query.showIgnored === 'true') {
    params.set('showIgnored', 'true')
  }

  try {
    return await proxyServerRequest<WorkspaceDirectoryResponse>(
      event,
      `/api/chats/${encodeChatIdSegment(chatId)}/files?${params.toString()}`
    )
  } catch (error) {
    const details = error as { statusCode?: number, statusMessage?: string }
    throw createError({
      statusCode: details.statusCode ?? 500,
      statusMessage: details.statusMessage ?? 'Workspace directory listing failed.'
    })
  }
})

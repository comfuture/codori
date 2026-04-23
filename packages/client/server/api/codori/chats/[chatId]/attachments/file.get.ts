import {
  createError,
  defineEventHandler,
  getQuery,
  getRouterParam
} from 'h3'
import { encodeChatIdSegment } from '~~/shared/codori'
import { proxyServerFetch } from '../../../../../utils/server-proxy'

export default defineEventHandler(async (event) => {
  const chatId = getRouterParam(event, 'chatId')
  const path = typeof getQuery(event).path === 'string' ? String(getQuery(event).path) : ''
  if (!chatId || !path) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Missing attachment path.'
    })
  }

  const response = await proxyServerFetch(
    event,
    `/api/chats/${encodeChatIdSegment(chatId)}/attachments/file?${new URLSearchParams({ path }).toString()}`
  )

  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null
    throw createError({
      statusCode: response.status,
      statusMessage: body?.error?.message ?? 'Attachment preview failed.',
      data: body
    })
  }

  const headers = new Headers()
  for (const [key, value] of response.headers.entries()) {
    headers.set(key, value)
  }

  return new Response(response.body, {
    status: response.status,
    headers
  })
})
